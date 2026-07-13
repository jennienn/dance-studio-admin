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
Supabase 대시보드의 SQL Editor에 `supabase/migrations/0001_init.sql` 내용을 그대로 붙여넣고 실행하세요.
(또는 Supabase CLI가 설치되어 있다면 `supabase db push`)

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

## 아직 구현 안 된 부분 (다음 작업)

- **화면(UI)**: `src/app/page.tsx`는 임시 안내 문구만 있습니다. 프로토타입(index.html)의 홈/오늘수업/회원/단체출석
  화면을 React 컴포넌트로 옮기고, 지금 만든 API 라우트들을 `fetch`로 연결하는 작업이 남아있습니다.
- **알림톡 실연동**: `sendNotification()` 함수(여러 API 라우트에 TODO로 표시됨)가 항상 성공만 반환하는
  더미 상태입니다. SOLAPI 등 발송 대행사 API 키를 받으면 이 함수만 교체하면 됩니다.
- **환불 정책**: `/api/payments/[id]/refund`는 결제 금액만 기록하고 있고, 환불 시 해당 enrollment_cycle을
  어떻게 처리할지는 아직 정책이 확정되지 않아 TODO로 남겨뒀습니다 (요구사항명세서 확인 후 반영 필요).
- **Vercel Cron 등록**: `vercel.json`에 스케줄은 넣어뒀지만, Vercel 프로젝트 환경변수에 `CRON_SECRET`을
  실제로 등록해야 동작합니다.

## 배포

1. GitHub에 이 프로젝트를 push
2. Vercel에서 해당 repo를 import (Pro 플랜 필요 — 상업적 서비스는 Hobby 플랜 이용약관상 불가)
3. Vercel 프로젝트 환경변수에 `.env.local`과 동일한 값 + `CRON_SECRET` 등록
4. 배포 후 Vercel 프로젝트 설정 → Cron Jobs에서 `/api/internal/notifications/run`이 매일 등록되어 있는지 확인

자세한 배경(기술스택 선정 이유, 예상 비용 등)은 함께 전달받은 01~05번 문서를 참고하세요.
