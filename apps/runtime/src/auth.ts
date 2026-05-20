import crypto from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";

// ── Schema ────────────────────────────────────────────

export const LoginInputSchema = z.object({
  email: z.string().email("无效的邮箱格式"),
  password: z.string().min(1, "密码不能为空"),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

// ── Table ────────────────────────────────────────────

const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const STMT_INSERT_USER = `
INSERT OR FAIL INTO users (id, email, password_hash, created_at)
VALUES (?, ?, ?, ?)
`;

const STMT_FIND_USER_BY_EMAIL = `
SELECT id, email, password_hash AS passwordHash, created_at AS createdAt
FROM users
WHERE email = ?
`;

// ── Helpers ──────────────────────────────────────────

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const ITERATIONS = 16384; // scrypt CPU cost

function generateId(): string {
  return crypto.randomUUID();
}

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, stored: string): boolean {
  // stored format: "salt:hash"
  const colon = stored.indexOf(":");
  if (colon === -1) return false;
  const salt = stored.slice(0, colon);
  const expected = stored.slice(colon + 1);
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return actual === expected;
}

// ── Public API ───────────────────────────────────────

export function initAuthTables(db: Database.Database): void {
  db.exec(CREATE_USERS_TABLE);
}

export function createUser(
  db: Database.Database,
  email: string,
  password: string
): UserRecord {
  const { hash, salt } = hashPassword(password);
  const id = generateId();
  const now = Date.now();
  const stmt = db.prepare(STMT_INSERT_USER);
  stmt.run(id, email, `${salt}:${hash}`, now);
  return { id, email, passwordHash: `${salt}:${hash}`, createdAt: now };
}

export interface LoginResult {
  success: boolean;
  user?: Omit<UserRecord, "passwordHash">;
  error?: string;
}

/**
 * 处理用户登录。先校验输入格式，再查用户，最后验证密码。
 * 密码错误时返回统一的模糊提示（不暴露用户是否存在）。
 */
export function loginUser(
  db: Database.Database,
  input: LoginInput
): LoginResult {
  const parsed = LoginInputSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return {
      success: false,
      error: firstError?.message ?? "输入格式错误",
    };
  }

  const { email, password } = parsed.data;

  const stmt = db.prepare(STMT_FIND_USER_BY_EMAIL);
  const user = stmt.get(email) as UserRecord | undefined;

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return {
      success: false,
      error: "邮箱或密码错误",
    };
  }

  const { passwordHash: _, ...safeUser } = user;
  return { success: true, user: safeUser };
}
