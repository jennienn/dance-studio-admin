import { describe, expect, it } from "vitest";
import { formatPhoneInput, isValidMemberPhone } from "@/lib/phone";

describe("회원 전화번호", () => {
  it("숫자를 입력하면 010-0000-0000 형식으로 자동 변환한다", () => {
    expect(formatPhoneInput("010")).toBe("010");
    expect(formatPhoneInput("0101234")).toBe("010-1234");
    expect(formatPhoneInput("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneInput("010-1234-56789")).toBe("010-1234-5678");
  });

  it("숫자가 아닌 문자는 입력값에서 제거한다", () => {
    expect(formatPhoneInput("010-ab12-34cd-5678")).toBe("010-1234-5678");
  });

  it("010-숫자4자리-숫자4자리만 유효하다", () => {
    expect(isValidMemberPhone("010-1234-5678")).toBe(true);
    expect(isValidMemberPhone("01012345678")).toBe(false);
    expect(isValidMemberPhone("011-1234-5678")).toBe(false);
    expect(isValidMemberPhone("010-123-5678")).toBe(false);
  });
});
