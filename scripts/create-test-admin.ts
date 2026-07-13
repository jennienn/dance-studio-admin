import { createClient } from "@supabase/supabase-js";
import { loadAndValidateTestEnvironment } from "../tests/support/test-env";

async function main() {
  const env = loadAndValidateTestEnvironment({ requireServiceRole: true });
  if (!env.adminEmail || !env.adminPassword) {
    throw new Error("TEST_ADMIN_EMAIL과 TEST_ADMIN_PASSWORD가 필요합니다.");
  }

  const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;

  const existing = users.users.find((user) => user.email === env.adminEmail);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: env.adminPassword,
      email_confirm: true
    });
    if (error) throw error;
    console.info(`[test-auth] local admin updated: ${env.adminEmail}`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email: env.adminEmail,
      password: env.adminPassword,
      email_confirm: true
    });
    if (error) throw error;
    console.info(`[test-auth] local admin created: ${env.adminEmail}`);
  }
}

void main();
