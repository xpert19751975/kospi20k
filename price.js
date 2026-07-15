// 한국투자증권(KIS) Open API 프록시
// 브라우저 → 이 함수 → KIS API 순서로 호출합니다.
// (브라우저에서 KIS를 직접 부르면 CORS에 막히고 시크릿이 노출되므로 서버를 한 번 거칩니다.)
//
// 필요한 환경변수 (Vercel > Settings > Environment Variables 에 등록):
//   KIS_APP_KEY     : KIS에서 발급받은 앱키
//   KIS_APP_SECRET  : KIS에서 발급받은 앱시크릿
//
// 실투자 계정 기준 도메인입니다. 모의투자 계정이면 아래 BASE를 모의투자 도메인으로 바꾸세요.

const BASE = "https://openapi.koreainvestment.com:9443";

// 토큰은 발급 후 약 24시간 유효합니다. 웜 인스턴스 동안 재사용해 발급 호출을 아낍니다.
let cachedToken = null;
let tokenExpiry = 0;

async function getToken(key, secret) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 60_000) return cachedToken;

  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: key,
      appsecret: secret,
    }),
  });

  const j = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error("토큰 발급 실패: " + JSON.stringify(j));
  }
  cachedToken = j.access_token;
  // expires_in(초) 사용, 없으면 23시간으로 가정
  tokenExpiry = Date.now() + (j.expires_in ? j.expires_in * 1000 : 23 * 3600 * 1000);
  return cachedToken;
}

module.exports = async (req, res) => {
  // 같은 도메인에서 서빙되면 CORS 불필요하지만, 별도 배포 대비 허용
  res.setHeader("Access-Control-Allow-Origin", "*");

  const key = process.env.KIS_APP_KEY;
  const secret = process.env.KIS_APP_SECRET;
  if (!key || !secret) {
    res.status(500).json({ error: "환경변수 KIS_APP_KEY / KIS_APP_SECRET 가 설정되지 않았습니다." });
    return;
  }

  // 종목코드 파싱 (Node 서버리스: req.query 또는 URL 파싱)
  let code = req.query && req.query.code;
  if (!code) {
    const u = new URL(req.url, "http://x");
    code = u.searchParams.get("code");
  }
  if (!/^\d{6}$/.test(code || "")) {
    res.status(400).json({ error: "종목코드는 6자리 숫자여야 합니다." });
    return;
  }

  try {
    const token = await getToken(key, secret);
    const url =
      `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
      `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;

    const r = await fetch(url, {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: key,
        appsecret: secret,
        tr_id: "FHKST01010100", // 국내주식 현재가 시세
        custtype: "P",          // 개인
      },
    });

    const j = await r.json();
    const out = j.output;
    if (!out || out.stck_prpr == null) {
      res.status(502).json({ error: "시세 조회 실패", detail: j });
      return;
    }

    res.status(200).json({
      code,
      name: out.hts_kor_isnm || null,     // 종목명
      price: Number(out.stck_prpr),        // 현재가
      change: Number(out.prdy_vrss),       // 전일 대비
      changeRate: Number(out.prdy_ctrt),   // 등락률(%)
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
