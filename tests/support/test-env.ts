import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

export interface TestEnvironment {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
  adminEmail?: string;
  adminPassword?: string;
}

const TEST_ENV_FILE = path.resolve(process.cwd(), ".env.test.local");

export function hasTestEnvironmentFile(): boolean {
  return existsSync(TEST_ENV_FILE);
}

export function loadAndValidateTestEnvironment(options: { requireServiceRole?: boolean } = {}): TestEnvironment {
  if (process.env.NODE_ENV !== "test" && process.env.TEST_MODE !== "true") {
    throw new Error("안전 중단: NODE_ENV=test 또는 TEST_MODE=true가 필요합니다.");
  }
  if (!existsSync(TEST_ENV_FILE)) {
    throw new Error("안전 중단: .env.test.local이 없습니다. .env.local은 테스트에 사용하지 않습니다.");
  }

  const loaded = loadDotenv({ path: TEST_ENV_FILE, override: true });
  if (loaded.error || !loaded.parsed) throw new Error("안전 중단: .env.test.local을 읽을 수 없습니다.");
  const values = loaded.parsed;

  const url = values.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const projectRef = values.TEST_SUPABASE_PROJECT_REF?.trim() ?? "";
  const fileTestMode = values.TEST_MODE?.trim() === "true";

  if (!url) throw new Error("안전 중단: NEXT_PUBLIC_SUPABASE_URL이 비어 있습니다.");
  if (!projectRef) throw new Error("안전 중단: TEST_SUPABASE_PROJECT_REF가 비어 있습니다.");
  if (!anonKey) throw new Error("안전 중단: NEXT_PUBLIC_SUPABASE_ANON_KEY가 비어 있습니다.");
  if (options.requireServiceRole && !serviceRoleKey) {
    throw new Error("안전 중단: SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.");
  }
  if (/prod(?:uction)?/i.test(`${url} ${projectRef}`)) {
    throw new Error("안전 중단: URL 또는 project ref에 production/prod가 포함되어 있습니다.");
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("안전 중단: NEXT_PUBLIC_SUPABASE_URL이 올바른 URL이 아닙니다.");
  }
  const isLocal = hostname === "127.0.0.1" || hostname === "localhost";
  if (isLocal) {
    if (!fileTestMode || projectRef !== "local") {
      throw new Error("안전 중단: 로컬 Supabase는 TEST_MODE=true 및 TEST_SUPABASE_PROJECT_REF=local이어야 합니다.");
    }
  } else {
    const urlProjectRef = hostname.endsWith(".supabase.co") ? hostname.slice(0, -".supabase.co".length) : "";
    if (!urlProjectRef || urlProjectRef !== projectRef) {
      throw new Error(
        `안전 중단: URL project ref(${urlProjectRef || "확인 불가"})와 TEST_SUPABASE_PROJECT_REF(${projectRef})가 다릅니다.`
      );
    }
  }

  console.info(`[test-db] target URL: ${url}`);
  console.info(`[test-db] project ref: ${projectRef}`);

  return {
    url,
    anonKey,
    serviceRoleKey,
    projectRef,
    adminEmail: values.TEST_ADMIN_EMAIL?.trim(),
    adminPassword: values.TEST_ADMIN_PASSWORD?.trim()
  };
}
