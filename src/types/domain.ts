export type UserRole = 'SELLER' | 'BUYER' | 'COLLECTOR' | 'ADMIN';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  accountStatus: string;
  roles: UserRole[];
  isDemoSeed: boolean;
}

export interface MaterialCategory {
  id: number;
  slug: string;
  name: string;
  description: string;
  handling_guidance: string;
  image_url: string | null;
  default_unit_id: number;
  default_unit_code: string;
  default_unit_name: string;
  is_active?: number;
}

export interface MaterialUnit {
  id: number;
  code: string;
  name: string;
  dimension: 'MASS' | 'COUNT' | 'BUNDLE';
  base_factor: number;
  is_active?: number;
}

export interface ServiceArea {
  id: number;
  name: string;
  city: string;
  postal_prefixes: string;
  is_active?: number;
}

export interface NotificationItem {
  id: number;
  event_type: string;
  title: string;
  body: string;
  link_path: string;
  delivery_channel: string;
  is_read: number;
  created_at: string;
}

export interface GuidanceTopic {
  topic: string;
  title: string;
  summary: string;
  steps: string[];
  importantNote: string;
}
