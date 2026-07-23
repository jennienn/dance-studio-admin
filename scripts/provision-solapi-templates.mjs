import { createHmac, randomBytes } from "node:crypto";

const API_BASE = "https://api.solapi.com";
const apiKey = process.env.SOLAPI_API_KEY?.trim();
const apiSecret = process.env.SOLAPI_API_SECRET?.trim();

if (!apiKey || !apiSecret) {
  throw new Error("SOLAPI_API_KEY와 SOLAPI_API_SECRET이 필요합니다.");
}

function authorization() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function request(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authorization(),
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path}: ${body.errorMessage ?? body.message ?? body.errorCode ?? response.status}`);
  }
  return body;
}

const channelResponse = await request("/kakao/v2/channels?isMine=true&limit=100");
const channels = channelResponse.channelList ?? [];
if (channels.length !== 1) {
  throw new Error(`본인 소유 카카오 채널이 1개여야 합니다. 현재 ${channels.length}개입니다.`);
}
const channel = channels[0];

const senders = await request("/senderid/v1/numbers/active");
if (!Array.isArray(senders) || senders.length !== 1) {
  throw new Error(`활성 발신번호가 1개여야 합니다. 현재 ${Array.isArray(senders) ? senders.length : 0}개입니다.`);
}
const senderPhone = typeof senders[0] === "string" ? senders[0] : senders[0]?.phoneNumber;
if (!senderPhone) {
  throw new Error("활성 발신번호 응답에서 전화번호를 찾을 수 없습니다.");
}

const definitions = [
  {
    env: "KAKAO_COMPLETED_SOLO_TEMPLATE_ID",
    name: "엘라노르_개인레슨_등록완료",
    content: "개인레슨 #{총횟수}회 등록 및 결제가 완료되었습니다."
  },
  {
    env: "KAKAO_COMPLETED_GROUP_TEMPLATE_ID",
    name: "엘라노르_단체레슨_등록완료",
    content: "#{수업명} 등록 및 결제가 완료되었습니다."
  },
  {
    env: "KAKAO_DUE_SOLO_TEMPLATE_ID",
    name: "엘라노르_개인레슨_잔여안내",
    content: "현재 #{총횟수}회 중 1회 남았습니다. 재등록 원하시면 재결제 부탁드립니다."
  },
  {
    env: "KAKAO_DUE_GROUP_TEMPLATE_ID",
    name: "엘라노르_단체레슨_결제안내",
    content: "#{수업명} 수강 기간이 1주일 남았습니다. 재등록 원하시면 1주일 이내에 결제 부탁드립니다."
  }
];

const existingResponse = await request(
  `/kakao/v2/templates/?channelId=${encodeURIComponent(channel.channelId)}&isMine=true&limit=100`
);
const existing = existingResponse.templateList ?? [];
const provisioned = [];

for (const definition of definitions) {
  const matches = existing.filter((template) => template.name === definition.name && !template.isDeleted);
  if (matches.length > 1) {
    throw new Error(`${definition.name}: 같은 이름의 템플릿이 여러 개입니다.`);
  }

  let template = matches[0];
  if (template && template.content !== definition.content) {
    throw new Error(`${definition.name}: 기존 템플릿 문구가 코드와 다릅니다.`);
  }
  if (!template) {
    template = await request("/kakao/v2/templates", {
      method: "POST",
      body: JSON.stringify({
        channelId: channel.channelId,
        name: definition.name,
        content: definition.content,
        categoryCode: "003001",
        messageType: "BA",
        emphasizeType: "NONE",
        securityFlag: false
      })
    });
  }

  if (template.status === "PENDING") {
    template = await request(`/kakao/v2/templates/${encodeURIComponent(template.templateId)}/inspection`, {
      method: "PUT",
      body: JSON.stringify({ comment: "댄스학원 수강 등록 및 결제 예정 안내용 정보성 메시지입니다." })
    });
  }

  provisioned.push({
    env: definition.env,
    templateId: template.templateId,
    status: template.status
  });
}

console.log(
  JSON.stringify(
    {
      channelId: channel.channelId,
      channelName: channel.channelName,
      senderPhone,
      templates: provisioned
    },
    null,
    2
  )
);
