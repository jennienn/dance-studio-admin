import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAndValidateTestEnvironment } from "../tests/support/test-env";
import type { SeedManifest } from "../tests/support/seed-manifest";

async function main() {
  const env = loadAndValidateTestEnvironment({ requireServiceRole: true });
  const artifactDir = path.resolve(process.cwd(), "test-artifacts");
  let files: string[];
  try {
    files = (await readdir(artifactDir)).filter((file) => /^seed-manifest-.*\.json$/.test(file)).sort();
  } catch {
    console.info("[test-cleanup] manifest 디렉터리가 없어 아무 데이터도 삭제하지 않습니다.");
    return;
  }
  if (files.length === 0) {
    console.info("[test-cleanup] manifest가 없어 아무 데이터도 삭제하지 않습니다.");
    return;
  }

  const requestedRunId = process.argv[2];
  const targetFile = requestedRunId ? `seed-manifest-${requestedRunId}.json` : files.at(-1)!;
  if (!files.includes(targetFile)) throw new Error(`[test-cleanup] manifest를 찾을 수 없습니다: ${targetFile}`);
  const manifestPath = path.join(artifactDir, targetFile);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SeedManifest;
  if (manifest.projectRef !== env.projectRef || manifest.targetUrl !== env.url) {
    throw new Error("안전 중단: manifest의 테스트 프로젝트와 현재 테스트 프로젝트가 다릅니다.");
  }

  const client = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  manifest.cleanup = {
    startedAt: new Date().toISOString(),
    verifiedSequences: []
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.info(`[test-cleanup] runId: ${manifest.runId}`);
  console.info(`[test-cleanup] 삭제 대상: ${manifest.rows.length}행`);

  for (const row of [...manifest.rows].sort((a, b) => b.sequence - a.sequence)) {
    let before = client.from(row.table).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(row.key)) before = before.eq(column, value);
    const { count: beforeCount, error: countError } = await before;
    if (countError) throw new Error(`${row.table} 삭제 전 확인 실패: ${countError.message}`);
    console.info(`[test-cleanup] #${row.sequence} ${row.table} 대상 ${beforeCount ?? 0}행`);

    if ((beforeCount ?? 0) > 0) {
      let deletion = client.from(row.table).delete();
      for (const [column, value] of Object.entries(row.key)) deletion = deletion.eq(column, value);
      const { error } = await deletion;
      if (error) throw new Error(`${row.table} 삭제 실패: ${error.message}`);
    }

    let after = client.from(row.table).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(row.key)) after = after.eq(column, value);
    const { count: afterCount, error: verifyError } = await after;
    if (verifyError || afterCount !== 0) {
      throw new Error(`${row.table} 삭제 검증 실패: ${verifyError?.message ?? `${afterCount}행 남음`}`);
    }
    manifest.cleanup.verifiedSequences.push(row.sequence);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  manifest.cleanup.completedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.info(`[test-cleanup] 삭제 및 검증 완료: ${targetFile}`);
}

void main();
