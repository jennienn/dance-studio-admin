import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
      <p style={{ color: "var(--text-sub)", marginBottom: 4 }}>404</p>
      <h1 className="page-title" style={{ marginBottom: 12 }}>페이지를 찾을 수 없습니다.</h1>
      <p>주소가 잘못되었거나 페이지가 이동되었습니다.</p>
      <Link href="/" style={{ display: "inline-block", marginTop: 16 }}>홈으로 돌아가기</Link>
    </main>
  );
}
