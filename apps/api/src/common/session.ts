import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionContext {
  storeId: string;
  staffId: string;
}

/** Admin-session gate shared by resource controllers (api-design.md §Auth). */
export function requireSession(req: Request): SessionContext {
  const { storeId, staffId } = req.session;
  if (!storeId || !staffId) throw new UnauthorizedException('Sign in first');
  return { storeId, staffId };
}
