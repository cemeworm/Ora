import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initAuthTables,
  createUser,
  loginUser,
  type UserRecord,
} from "./auth.js";

describe("loginUser", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initAuthTables(db);
  });

  it("succeeds with correct email and password", () => {
    createUser(db, "alice@example.com", "secret-password");
    const result = loginUser(db, { email: "alice@example.com", password: "secret-password" });
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user!.email).toBe("alice@example.com");
    expect(result.user!.id).toBeDefined();
    expect((result.user! as any).passwordHash).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("fails with wrong password", () => {
    createUser(db, "alice@example.com", "correct-password");
    const result = loginUser(db, { email: "alice@example.com", password: "wrong-password" });
    expect(result.success).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.error).toBe("邮箱或密码错误");
  });

  it("fails when user does not exist", () => {
    const result = loginUser(db, { email: "ghost@example.com", password: "anything" });
    expect(result.success).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.error).toBe("邮箱或密码错误");
  });

  it("fails with invalid email format", () => {
    const result = loginUser(db, { email: "not-an-email", password: "pwd" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("无效的邮箱格式");
  });

  it("fails with empty password", () => {
    const result = loginUser(db, { email: "test@example.com", password: "" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("密码不能为空");
  });

  it("does not leak whether user exists on wrong credentials", () => {
    createUser(db, "bob@example.com", "real-password");
    const resultExists = loginUser(db, { email: "bob@example.com", password: "wrong" });
    const resultNotExists = loginUser(db, { email: "nobody@example.com", password: "wrong" });
    expect(resultExists.error).toBe("邮箱或密码错误");
    expect(resultNotExists.error).toBe("邮箱或密码错误");
  });

  it("succeeds for multiple users independently", () => {
    createUser(db, "user1@example.com", "pass1");
    createUser(db, "user2@example.com", "pass2");
    const r1 = loginUser(db, { email: "user1@example.com", password: "pass1" });
    const r2 = loginUser(db, { email: "user2@example.com", password: "pass2" });
    expect(r1.success).toBe(true);
    expect(r1.user!.email).toBe("user1@example.com");
    expect(r2.success).toBe(true);
    expect(r2.user!.email).toBe("user2@example.com");
  });
});
