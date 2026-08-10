export type SupabasePublicConfig = Readonly<{
  url: string;
  anonKey: string;
}>;

export type SupabaseConfigStatus =
  | { configured: true }
  | { configured: false; missing: readonly SupabaseEnvironmentName[] };

export type SupabaseEnvironmentName =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY";

type PublicEnvironment = Partial<Record<SupabaseEnvironmentName, string>>;

export class SupabaseConfigurationError extends Error {
  readonly code = "SUPABASE_CONFIGURATION_MISSING";
  readonly missing: readonly SupabaseEnvironmentName[];

  constructor(missing: readonly SupabaseEnvironmentName[]) {
    super(`Supabase is not configured. Missing: ${missing.join(", ")}`);
    this.name = "SupabaseConfigurationError";
    this.missing = missing;
  }
}

function runtimePublicEnvironment(): PublicEnvironment {
  // Direct property reads are required so Next.js can inline NEXT_PUBLIC values.
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabaseConfigStatus(
  environment: PublicEnvironment = runtimePublicEnvironment(),
): SupabaseConfigStatus {
  const missing: SupabaseEnvironmentName[] = [];

  if (!environment.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return missing.length === 0
    ? { configured: true }
    : { configured: false, missing };
}

export function getSupabasePublicConfig(
  environment: PublicEnvironment = runtimePublicEnvironment(),
): SupabasePublicConfig {
  const status = getSupabaseConfigStatus(environment);

  if (!status.configured) {
    throw new SupabaseConfigurationError(status.missing);
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL!.trim();

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("Supabase URL must use HTTPS outside local development");
    }
  } catch (cause) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid Supabase URL", {
      cause,
    });
  }

  return {
    url,
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  };
}
