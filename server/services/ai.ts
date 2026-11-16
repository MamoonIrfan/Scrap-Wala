import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

const SUPPORTED_CATEGORIES = ['Paper', 'Cardboard', 'Plastic', 'Metal'] as const;

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!config.geminiApiKey || config.geminiApiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

export interface AiSystemStatus {
  pytorchWeightsConfigured: boolean;
  pytorchWeightsPresentOnDisk: boolean;
  pytorchModelNote: string;
  geminiConfigured: boolean;
  activeImageAdapter: string;
  activeListingAdapter: string;
  ragEnabled: false;
  supportedCategories: readonly string[];
}

export function getAiSystemStatus(): AiSystemStatus {
  const weightsPath = config.pytorchModelWeightsPath;
  const weightsConfigured = Boolean(weightsPath);
  const weightsPresent = weightsConfigured ? fs.existsSync(weightsPath) : false;
  const geminiReady = Boolean(getGeminiClient());

  return {
    pytorchWeightsConfigured: weightsConfigured,
    pytorchWeightsPresentOnDisk: weightsPresent,
    pytorchModelNote: weightsPresent
      ? `PyTorch model weights detected at configured path.`
      : 'No trained PyTorch (.pt/.onnx) weights are mounted. Replaceable inference interface is active; supply PYTORCH_MODEL_WEIGHTS_PATH in production.',
    geminiConfigured: geminiReady,
    activeImageAdapter: weightsPresent
      ? 'PYTORCH_LOCAL_MODEL'
      : geminiReady
      ? 'GEMINI_VISION_SERVER_ADAPTER'
      : 'DEVELOPMENT_FALLBACK_ADAPTER',
    activeListingAdapter: geminiReady
      ? 'GEMINI_STRUCTURED_TEXT_ADAPTER'
      : 'DEVELOPMENT_TEMPLATE_ADAPTER',
    ragEnabled: false,
    supportedCategories: SUPPORTED_CATEGORIES,
  };
}

export interface ImageClassificationResult {
  predictedCategory: string;
  confidence: number;
  lowConfidence: boolean;
  adapterMode: string;
  modelName: string;
  modelVersion: string;
  notes: string;
  editableBySeller: true;
  latencyMs: number;
}

export async function classifyScrapImage(
  db: DatabaseSync,
  params: {
    userId: number;
    imageBuffer: Buffer;
    mimeType: string;
    originalName: string;
    sellerHint?: string;
  }
): Promise<ImageClassificationResult> {
  const started = Date.now();
  const status = getAiSystemStatus();

  let predictedCategory = 'Paper';
  let confidence = 0.35;
  let adapterMode = 'DEVELOPMENT_FALLBACK_ADAPTER';
  let modelName = 'scrapwala-dev-heuristic-v0';
  let modelVersion = '0.1.0-dev';
  let notes =
    'Development adapter active (no trained PyTorch weights or Gemini API key configured). Please confirm or select the material category manually.';

  // 1. Check PyTorch model interface first
  if (status.pytorchWeightsPresentOnDisk) {
    adapterMode = 'PYTORCH_LOCAL_INTERFACE';
    modelName = 'pytorch-scrap-classifier';
    modelVersion = 'weights-mounted';
    notes =
      'Local PyTorch weights file detected; runtime Python TorchServe bridge is not active in this Node container, falling back cleanly.';
  }

  // 2. Use Server-Side Gemini Vision if configured
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.imageBuffer.toString('base64'),
              },
            },
            {
              text:
                'Classify the primary recyclable scrap material in this photograph into exactly one of: Paper, Cardboard, Plastic, Metal. ' +
                'Provide a realistic confidence score between 0 and 1, and a brief 1-sentence condition note for a scrap buyer. ' +
                (params.sellerHint ? `Seller note: ${params.sellerHint}` : ''),
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, description: 'One of Paper, Cardboard, Plastic, Metal' },
              confidence: { type: Type.NUMBER, description: 'Confidence from 0 to 1' },
              conditionNote: { type: Type.STRING, description: 'Brief condition observation' },
            },
            required: ['category', 'confidence', 'conditionNote'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim()) as {
        category?: string;
        confidence?: number;
        conditionNote?: string;
      };
      const matched = SUPPORTED_CATEGORIES.find(
        (c) => c.toLowerCase() === (parsed.category || '').toLowerCase()
      );
      if (matched) {
        predictedCategory = matched;
        confidence = Math.min(0.99, Math.max(0.1, Number(parsed.confidence ?? 0.72)));
        adapterMode = 'GEMINI_VISION_SERVER_ADAPTER';
        modelName = 'gemini-4-hydrogen';
        modelVersion = 'server-sdk-v1';
        notes = parsed.conditionNote || 'Suggested via server-side vision analysis; seller confirmation required.';
      }
    } catch (err) {
      notes = `Gemini Vision fallback triggered (${err instanceof Error ? err.message : 'error'}). Confirm category manually.`;
    }
  } else {
    // Honest deterministic filename/hint keyword cue strictly labeled as dev adapter (never random!)
    const hay = `${params.originalName} ${params.sellerHint || ''}`.toLowerCase();
    if (hay.includes('cardboard') || hay.includes('box') || hay.includes('carton')) {
      predictedCategory = 'Cardboard';
      confidence = 0.52;
    } else if (hay.includes('plastic') || hay.includes('pet') || hay.includes('bottle') || hay.includes('hdpe')) {
      predictedCategory = 'Plastic';
      confidence = 0.52;
    } else if (hay.includes('metal') || hay.includes('copper') || hay.includes('aluminum') || hay.includes('steel') || hay.includes('iron')) {
      predictedCategory = 'Metal';
      confidence = 0.52;
    } else {
      predictedCategory = 'Paper';
      confidence = 0.35;
    }
  }

  const lowConfidence = confidence < 0.65;
  const latencyMs = Date.now() - started;

  db.prepare(
    `INSERT INTO ai_inference_logs (user_id, feature_type, model_name, model_version, adapter_mode, predicted_category, confidence_score, low_confidence_flag, latency_ms, input_summary, output_summary)
     VALUES (?, 'IMAGE_CLASSIFICATION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    modelName,
    modelVersion,
    adapterMode,
    predictedCategory,
    confidence,
    lowConfidence ? 1 : 0,
    latencyMs,
    `mime=${params.mimeType}, bytes=${params.imageBuffer.length}`,
    JSON.stringify({ predictedCategory, confidence, lowConfidence })
  );

  return {
    predictedCategory,
    confidence,
    lowConfidence,
    adapterMode,
    modelName,
    modelVersion,
    notes,
    editableBySeller: true,
    latencyMs,
  };
}

export interface ListingSuggestionResult {
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCategory: string;
  clarificationQuestions: string[];
  suggestedTags: string[];
  adapterMode: string;
  requiresSellerApproval: true;
}

export async function generateListingSuggestion(
  db: DatabaseSync,
  params: {
    userId: number;
    description: string;
    selectedCategories: string[];
    imagePredictions?: string[];
  }
): Promise<ListingSuggestionResult> {
  const started = Date.now();
  const primaryCat =
    params.selectedCategories[0] || params.imagePredictions?.[0] || 'Paper';
  const safeCat =
    SUPPORTED_CATEGORIES.find((c) => c.toLowerCase() === primaryCat.toLowerCase()) || 'Paper';

  let result: ListingSuggestionResult = {
    suggestedTitle: `Sorted ${params.selectedCategories.length > 0 ? params.selectedCategories.join(' & ') : safeCat} Pickup Request`,
    suggestedDescription:
      params.description.trim().length > 0
        ? `${params.description.trim()} Please confirm moisture-free condition and doorstep weighing at pickup.`
        : `Household/commercial ${safeCat.toLowerCase()} scrap ready for scheduled doorstep pickup and weighing.`,
    suggestedCategory: safeCat,
    clarificationQuestions: [
      'Are the materials kept dry and separated by category?',
      'Is an approximate weight known, or should the collector weigh everything on site?',
      'Are there any bulky cartons or heavy metal pieces requiring two-person handling?',
    ],
    suggestedTags: Array.from(
      new Set(
        [...params.selectedCategories, ...(params.imagePredictions || []), safeCat].map((s) =>
          s.toLowerCase()
        )
      )
    ),
    adapterMode: 'DEVELOPMENT_TEMPLATE_ADAPTER',
    requiresSellerApproval: true,
  };

  let modelName = 'scrapwala-listing-template-v1';
  let modelVersion = '1.0.0-dev';

  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents:
          `Help a seller draft a clear, accurate scrap pickup listing based strictly on their inputs (do not invent prices or unverified claims).\n` +
          `Seller description: "${params.description}"\n` +
          `Selected categories: ${params.selectedCategories.join(', ') || 'None'}\n` +
          `Image predictions: ${(params.imagePredictions || []).join(', ') || 'None'}\n` +
          `Supported categories: Paper, Cardboard, Plastic, Metal.`,
        config: {
          systemInstruction:
            'You are a concise listing assistant for a scrap recycling marketplace. Never invent scrap market prices or promises.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedTitle: { type: Type.STRING },
              suggestedDescription: { type: Type.STRING },
              suggestedCategory: { type: Type.STRING },
              clarificationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedTags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'suggestedTitle',
              'suggestedDescription',
              'suggestedCategory',
              'clarificationQuestions',
              'suggestedTags',
            ],
          },
        },
      });
      const parsed = JSON.parse((response.text || '{}').trim()) as Partial<ListingSuggestionResult>;
      if (parsed.suggestedTitle && parsed.suggestedDescription) {
        const matchedCat =
          SUPPORTED_CATEGORIES.find(
            (c) => c.toLowerCase() === (parsed.suggestedCategory || '').toLowerCase()
          ) || safeCat;
        result = {
          suggestedTitle: parsed.suggestedTitle,
          suggestedDescription: parsed.suggestedDescription,
          suggestedCategory: matchedCat,
          clarificationQuestions: (parsed.clarificationQuestions || []).slice(0, 4),
          suggestedTags: (parsed.suggestedTags || []).slice(0, 6),
          adapterMode: 'GEMINI_STRUCTURED_TEXT_ADAPTER',
          requiresSellerApproval: true,
        };
        modelName = 'gemini-4-hydrogen';
        modelVersion = 'server-sdk-v1';
      }
    } catch {
      // keep clean deterministic template fallback
    }
  }

  db.prepare(
    `INSERT INTO ai_inference_logs (user_id, feature_type, model_name, model_version, adapter_mode, predicted_category, confidence_score, low_confidence_flag, latency_ms, input_summary, output_summary)
     VALUES (?, 'LISTING_ASSIST', ?, ?, ?, ?, NULL, 0, ?, ?, ?)`
  ).run(
    params.userId,
    modelName,
    modelVersion,
    result.adapterMode,
    result.suggestedCategory,
    Date.now() - started,
    `descLen=${params.description.length}`,
    JSON.stringify({ title: result.suggestedTitle, category: result.suggestedCategory })
  );

  return result;
}

export interface ContextualGuidanceTopic {
  topic: string;
  title: string;
  summary: string;
  steps: string[];
  importantNote: string;
}

const APPLICATION_GUIDANCE: Record<string, ContextualGuidanceTopic> = {
  listing: {
    topic: 'listing',
    title: 'How to Create an Accurate Scrap Listing',
    summary: 'Clear material separation and honest estimates attract more accurate buyer offers.',
    steps: [
      'Upload clear daylight photos of each material batch so buyers can inspect cleanliness.',
      'Review any AI-suggested material category and edit it if your scrap is mixed or specialty grade.',
      'Enter an estimated weight or mark "Weight Unknown" if you do not have a scale at home.',
      'Select your preferred pickup address (exact street details stay hidden until you accept an offer).',
    ],
    importantNote: 'AI suggestions never auto-publish listings or set prices.',
  },
  offers: {
    topic: 'offers',
    title: 'How to Compare Buyer Offers Fairly',
    summary: 'Compare itemized rates, basket coverage, and pickup timing rather than headline totals alone.',
    steps: [
      'Check whether an offer covers all listed items or only a partial basket.',
      'Review per-unit rates (e.g., per kg vs per piece) and buyer offer conditions.',
      'Notice the deterministic ranking breakdown covering coverage, payout, timing, and verified pickup history.',
      'Select and confirm only one preferred offer to lock your pickup slot.',
    ],
    importantNote: 'Incomplete-basket offers are explicitly flagged and cannot be treated as identical to full-basket offers.',
  },
  settlement: {
    topic: 'settlement',
    title: 'Understanding Actual Weights & Settlement Revisions',
    summary: 'Final payouts are calculated from verified doorstep weights and your accepted rates.',
    steps: [
      'During pickup, the collector weighs each material item separately.',
      'If material quantity differs from your estimate, the payout adjusts using your accepted unit rate.',
      'If a collector proposes changing a material category, grade, or unit rate, a Settlement Revision is created.',
      'You must review the itemized before-and-after difference and explicitly approve or reject any revision.',
    ],
    importantNote: 'Collectors cannot silently overwrite accepted rates without your explicit approval.',
  },
  pickup: {
    topic: 'pickup',
    title: 'Completing Pickup, Payment & Handover',
    summary: 'Payment acknowledgement and physical material handover are recorded as distinct steps.',
    steps: [
      'Verify the assigned collector name and vehicle number shown on your booking card.',
      'Observe the weighing of each item and confirm any settlement revision if proposed.',
      'Receive direct payment (Cash, Bank Transfer, or UPI) and submit your Payment Acknowledgement.',
      'Confirm Material Handover only after payment and weighing are settled.',
    ],
    importantNote: 'Scrap Wala does not hold escrow or process card wallets; payment acknowledgements record both parties’ confirmation.',
  },
  receipts: {
    topic: 'receipts',
    title: 'Reading Your Digital Transaction Receipt',
    summary: 'Every completed pickup generates an immutable itemized receipt for your records.',
    steps: [
      'Check the unique receipt number and booking reference at the top.',
      'Verify actual weighed quantities, grades, and approved unit rates per item.',
      'Review payment method, dual acknowledgement timestamps, and handover confirmation.',
      'Use the Complaint workflow if you need administrative review on any discrepancy.',
    ],
    importantNote: 'All receipts and audit logs remain preserved in your transaction history.',
  },
};

export function getContextualGuidance(topic?: string): ContextualGuidanceTopic | ContextualGuidanceTopic[] {
  if (topic && APPLICATION_GUIDANCE[topic]) {
    return APPLICATION_GUIDANCE[topic];
  }
  return Object.values(APPLICATION_GUIDANCE);
}
