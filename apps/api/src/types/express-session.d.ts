import 'express-session';

declare module 'express-session' {
  interface SessionData {
    staffId?: string;
    storeId?: string;
  }
}
