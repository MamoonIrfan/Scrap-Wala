import { Router } from 'express';
import { getDb } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const notifications = db
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`
    )
    .all(req.authUser!.id);
  const unreadCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.authUser!.id) as { c: number }
  ).c;
  res.json({ notifications, unreadCount });
});

router.post('/:id/read', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.authUser!.id
  );
  res.json({ ok: true });
});

router.post('/read-all', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.authUser!.id);
  res.json({ ok: true });
});

export default router;
