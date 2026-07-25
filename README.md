# 댄스학원 관리 시스템 — 개발 세팅 가이드

프로토타입(index.html) 및 01~05 문서(요구사항명세서 v1.1, 유즈케이스, API명세서, DB설계서 v2, 예상비용)를
기준으로 만든 Next.js + Supabase 스캐폴드입니다.

## 핵심 구조 (v2)

```
members
  └─ enrollments        (수강권의 "정체성" — 재등록해도 이 행은 유지됨)
       └─ enrollment_cycles  (결제/재등록 1회 = 새 주기 1개. 이전 주기는 삭제되지 않고 completed로 보존)
            ├─ payments       (cycle당 결제 1건, UNIQUE)
            ├─ sessions       (개인레슨 회차, cycle 기준)
            ├─ cycle_schedules (단체레슨 요일 조합, cycle 기준)
            └─ notifications  (알림톡 발송 이력, cycle 기준)

classes
  └─ class_schedules    (반의 정규 요일: kpop반=월화수목, 다이어트댄스반=화목)
       └─ attendance_logs (cycle + schedule + date 기준 출석 기록)
```

**왜 이렇게 나눴는지**: 재등록할 때마다 기존 데이터를 덮어쓰지 않고 새 `enrollment_cycle`을 만들기 때문에,
"이 회원이 언제 얼마를 냈고 어떤 회차를 다녔는지"가 통째로 이력으로 남습니다.

## 로컬 개발 시작하기

### 1. Supabase 프로젝트 생성
1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성 (무료 플랜으로 개발 가능, 운영 전환 시 Pro로 업그레이드)
2. Project Settings → API에서 `Project URL`, `anon public key`, `service_role key` 확인

### 2. 환경변수 설정
```bash
cp .env.example .env.local
```
`.env.local`을 열어 위에서 확인한 값들을 채워 넣으세요. `SUPABASE_SERVICE_ROLE_KEY`는 절대
클라이언트 코드에 노출되면 안 됩니다 (서버 전용).

### 3. DB 마이그레이션 적용
새 로컬 또는 테스트 DB에는 `supabase/migrations`의 마이그레이션을 번호순으로 적용하세요.
운영 DB에는 `0001_init.sql`을 다시 실행하지 말고 현재 적용 이력을 확인한 뒤 누락된 마이그레이션만 적용해야 합니다.

이 마이그레이션은 테이블/트리거/RLS 정책뿐 아니라, 현재 운영 중인 두 반(kpop반, 다이어트 댄스반)과
요일 스케줄까지 초기 데이터로 함께 넣어줍니다.

### 4. 운영자 계정 생성
Supabase 대시보드 → Authentication → Users → "Add user"에서 이메일/비밀번호로 첫 운영자 계정을 만드세요.
이 시스템은 별도 회원가입 화면이 없습니다 (운영자 전용 서비스이므로 계정은 관리자가 직접 발급).

### 5. 패키지 설치 및 로컬 실행
```bash
npm install
npm run dev
```
`http://localhost:3000`으로 접속하면 `/login`으로 리다이렉트됩니다. 4번에서 만든 계정으로 로그인하세요.

## SOLAPI 알림톡 운영 준비

개인·단체 등록 완료 알림과 결제 임박 알림의 SOLAPI 연동, 발송 이력, 중복 방지 및 매일 실행되는
Vercel Cron 경로가 구현되어 있습니다. 템플릿 승인 전에는 실제 고객 번호로 발송하지 마세요.

1. `supabase/migrations/0006_real_notification_delivery.sql` 적용 여부를 확인합니다.
2. `.env.example`에 나열된 SOLAPI·카카오·Cron 환경변수를 로컬과 Vercel에 등록합니다.
3. `npm run notifications:check`로 값의 누락, 예시 값, 중복 템플릿 ID를 검사합니다.
4. 카카오 검수 승인 후 내부 번호로 아래 네 가지 템플릿을 각각 한 번씩 확인합니다.
   - 개인레슨 등록 완료
   - 단체레슨 등록 완료
   - 개인레슨 잔여 1회
   - 단체레슨 결제 1주 전
5. 같은 cycle과 알림 종류의 재호출이 중복 발송되지 않는지 확인합니다.

점검 명령은 환경변수의 실제 값을 출력하거나 SOLAPI에 네트워크 요청을 보내지 않습니다.

## 배포

1. GitHub에 이 프로젝트를 push
2. Vercel에서 해당 repo를 import (Pro 플랜 필요 — 상업적 서비스는 Hobby 플랜 이용약관상 불가)
3. Vercel 프로젝트 환경변수에 운영용 Supabase 및 알림톡 값과 무작위 `CRON_SECRET` 등록
4. 배포 후 Vercel 프로젝트 설정 → Cron Jobs에서 `/api/internal/notifications/run`이 매일 등록되어 있는지 확인

## 자동 테스트

단위 테스트는 Supabase 없이 실행할 수 있습니다.

```bash
npm run test
```

통합/E2E/seed는 운영 프로젝트와 완전히 분리된 Supabase 프로젝트만 사용합니다. 먼저
`.env.test.local.example`을 `.env.test.local`로 복사하고 전용 테스트 프로젝트 값과 테스트 운영자 계정을
입력한 뒤, `supabase/migrations/0001_init.sql`과 `0002_atomic_testable_operations.sql`을 순서대로 적용합니다.
테스트 스크립트는 URL의 project ref와 `TEST_SUPABASE_PROJECT_REF`가 정확히 같지 않거나 URL/ref에
`prod` 또는 `production`이 포함되면 실행을 중단합니다. `.env.local`은 테스트에서 읽지 않습니다.

```bash
npm run test:seed
npm run test:integration
npm run test:e2e
npm run test:cleanup
```

seed가 만든 모든 행은 `test-artifacts/seed-manifest-{runId}.json`에 즉시 기록됩니다. cleanup은 최신
manifest만 대상으로 하며, 특정 실행을 정리할 때는 `npm run test:cleanup -- {runId}`를 사용합니다.
manifest에 없는 행은 삭제하지 않습니다.

자세한 배경(기술스택 선정 이유, 예상 비용 등)은 함께 전달받은 01~05번 문서를 참고하세요.
