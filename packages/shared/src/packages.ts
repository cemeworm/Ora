import { z } from "zod";

export const ORA_HOST_ABI_VERSION = "ora-host-slot-v1" as const;
export const ORA_RUNTIME_ABI_VERSION = "ora-runtime-slot-v1" as const;

export const PackageSlotStatusSchema = z.enum(["active", "candidate", "previous", "failed"]);
export type PackageSlotStatus = z.infer<typeof PackageSlotStatusSchema>;

export const PackageVerificationStatusSchema = z.enum(["pending", "passed", "failed"]);
export type PackageVerificationStatus = z.infer<typeof PackageVerificationStatusSchema>;

export const PackageVerificationSchema = z.object({
  status: PackageVerificationStatusSchema,
  checkedAt: z.number().int().nonnegative().optional(),
  commands: z.array(z.string().min(1)).default([]),
  logPath: z.string().min(1).optional(),
  errors: z.array(z.string().min(1)).default([]),
});
export type PackageVerification = z.infer<typeof PackageVerificationSchema>;

export const PackageManifestSchema = z.object({
  versionId: z.string().min(1),
  semver: z.string().min(1),
  status: PackageSlotStatusSchema.default("candidate"),
  channel: z.string().min(1).default("local"),
  gitCommit: z.string().min(1).optional(),
  builtAt: z.number().int().nonnegative(),
  promotedAt: z.number().int().nonnegative().optional(),
  activatedAt: z.number().int().nonnegative().optional(),
  hostAbiVersion: z.literal(ORA_HOST_ABI_VERSION),
  runtimeAbiVersion: z.literal(ORA_RUNTIME_ABI_VERSION),
  sourceRoot: z.string().min(1).optional(),
  slotPath: z.string().min(1),
  frontendDistPath: z.string().min(1),
  runtimeSidecarPath: z.string().min(1),
  buildLogPath: z.string().min(1),
  verification: PackageVerificationSchema,
  migrationNotes: z.array(z.string().min(1)).default([]),
  rollbackTarget: z.string().min(1).optional(),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export const ActivePackagePointerSchema = z.object({
  activeVersionId: z.string().min(1).optional(),
  previousVersionId: z.string().min(1).optional(),
  channel: z.string().min(1).default("local"),
  activatedAt: z.number().int().nonnegative().optional(),
  compatibilityStatus: z.enum(["compatible", "incompatible", "unknown"]).default("unknown"),
});
export type ActivePackagePointer = z.infer<typeof ActivePackagePointerSchema>;

export const PackageStoreSnapshotSchema = z.object({
  rootPath: z.string().min(1),
  active: ActivePackagePointerSchema,
  packages: z.array(PackageManifestSchema),
});
export type PackageStoreSnapshot = z.infer<typeof PackageStoreSnapshotSchema>;

export const PackageBuildCandidateParamsSchema = z.object({
  versionId: z.string().min(1).optional(),
  semver: z.string().min(1).optional(),
  channel: z.string().min(1).default("local"),
  sourceRoot: z.string().min(1).optional(),
  gitCommit: z.string().min(1).optional(),
  migrationNotes: z.array(z.string().min(1)).default([]),
  verificationCommands: z.array(z.string().min(1)).optional(),
  skipBuildCommands: z.boolean().default(false),
});
export type PackageBuildCandidateParams = z.infer<typeof PackageBuildCandidateParamsSchema>;

export const PackageVerifyParamsSchema = z.object({
  versionId: z.string().min(1),
  commands: z.array(z.string().min(1)).optional(),
});
export type PackageVerifyParams = z.infer<typeof PackageVerifyParamsSchema>;

export const PackageVersionParamsSchema = z.object({
  versionId: z.string().min(1),
});
export type PackageVersionParams = z.infer<typeof PackageVersionParamsSchema>;
