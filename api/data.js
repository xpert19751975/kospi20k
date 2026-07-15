// 포트폴리오 데이터 클라우드 저장/조회 (Upstash Redis · KV)
// GET  /api/data  → 저장된 포트폴리오 JSON 반환
// POST /api/data  → 요청 본문(JSON)을 저장
//
// 브라우저의 localStorage는 그 브라우저에만 남기 때문에, 어디서 접속해도 같은 데이터를
// 보려면 서버(클라우드)에 저장해야 합니다. 이 함수가 그 저장소 역할을 합니다.
//
// 필요한 환경변수 (Vercel에서 KV/Upstash 저장소를 만들면 보통 자동으로 등록됩니다):
//   KV_REST_API_URL      (또는 UPSTASH_REDIS_REST_URL)
//   KV_REST_API_TOKEN    (또는 UPSTASH_REDIS_REST_TOKEN)
//
// (선택) 접근코드로 보호하려면:
//   APP_PASSCODE  = 원하는 비밀번호. 설정하면 저장/조회 시 이 코드가 있어야 합니다.

const KEY = "portfolio:default"; // 하나의 포트폴리오를 공유 저장

function getStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

// Upstash REST: POST 본문에 커맨드 배열을 담아 호출 → { result: ... }
async function kv(command) {
  const { url, token } = getStore();
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("KV 오류: " + JSON.stringify(j));
  return j.result;
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) { // 일부 런타임은 이미 파싱해 둠
      resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      return;
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-passcode");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { url, token } = getStore();
  if (!url || !token) {
    res.status(500).json({ error: "저장소가 설정되지 않았습니다. Vercel에서 KV(Upstash) 저장소를 연결하세요." });
    return;
  }

  // 접근코드 보호 (설정된 경우에만)
  const need = process.env.APP_PASSCODE;
  if (need) {
    const got = req.headers["x-passcode"];
    if (!got) { res.status(401).json({ error: "passcode required", passcodeRequired: true }); return; }
    if (got !== need) { res.status(403).json({ error: "잘못된 접근코드입니다." }); return; }
  }

  try {
    if (req.method === "GET") {
      const raw = await kv(["GET", KEY]);
      res.status(200).json({ data: raw ? JSON.parse(raw) : null });
      return;
    }
    if (req.method === "POST") {
      const bodyStr = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(bodyStr); } catch (e) { res.status(400).json({ error: "JSON 형식이 아닙니다." }); return; }
      await kv(["SET", KEY, JSON.stringify(parsed)]);
      res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
      return;
    }
    res.status(405).json({ error: "허용되지 않은 메서드" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
