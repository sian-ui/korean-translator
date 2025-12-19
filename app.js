let RULES = []; // {src,dst,mode,priority,cond,note}

const statusEl = document.getElementById("status");
const inputEl = document.getElementById("inputText");
const outputEl = document.getElementById("outputText");
const debugEl = document.getElementById("debugMode");

document.getElementById("btnTranslate").addEventListener("click", () => {
  const src = inputEl.value || "";
  outputEl.value = translate(src, RULES, debugEl.checked);
});

document.getElementById("btnReload").addEventListener("click", async () => {
  await loadRulesFromRepo();
});

document.getElementById("ruleFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const text = await f.text();
  RULES = parseRulesCSV(text);
  statusEl.textContent = `업로드 규칙 로드 완료: ${RULES.length}개`;
});

(async function init() {
  await loadRulesFromRepo();
})();

// -------------------------
// 1) rules.csv 로드 (repo에 있는 파일)
// -------------------------
async function loadRulesFromRepo() {
  try {
    statusEl.textContent = "rules.csv 불러오는 중...";
    const res = await fetch("./rules.csv", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    RULES = parseRulesCSV(text);
    statusEl.textContent = `규칙 로드 완료: ${RULES.length}개`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "규칙 로드 실패: rules.csv가 같은 폴더에 있는지 확인";
    RULES = [];
  }
}

// -------------------------
// 2) CSV 파서 (5열 또는 6열 지원)
// 헤더:
//  - (구) 현대어,중세어,적용방식,우선순위,비고
//  - (신) 현대어,중세어,적용방식,조건,우선순위,비고
// 비고에서 "조건=..."도 추출
// -------------------------
function parseRulesCSV(csvText) {
  const rows = splitCSV(csvText);
  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.trim());
  const idx = (name) => header.indexOf(name);

  const hasCondCol = idx("조건") !== -1;

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(x => (x ?? "").trim() === "")) continue;

    const src = (r[idx("현대어")] ?? r[0] ?? "").trim();
    const dst = (r[idx("중세어")] ?? r[1] ?? "").trim();
    const mode = normalizeMode((r[idx("적용방식")] ?? r[2] ?? "").trim());
    const note = (r[idx("비고")] ?? r[hasCondCol ? 5 : 4] ?? "").trim();

    let priority = (r[idx("우선순위")] ?? r[hasCondCol ? 4 : 3] ?? "").trim();
    priority = parseInt(priority, 10);
    if (Number.isNaN(priority)) priority = 0;

    let cond = "";
    if (hasCondCol) cond = ((r[idx("조건")] ?? "") + "").trim();
    if (!cond) cond = extractCondFromNote(note);

    if (!src && !dst) continue;

    out.push({
      src,
      dst,
      mode,
      priority,
      cond: cleanupCond(cond),
      note
    });
  }

  // 우선순위 desc, 길이 desc
  out.sort((a,b) => (b.priority - a.priority) || (b.src.length - a.src.length));
  return out;
}

// 아주 단순 CSV split (따옴표 포함 처리)
function splitCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    rows.push(parseCSVLine(line));
  }
  return rows;
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (ch === '"' ) {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeMode(m) {
  if (["그대로","일반","치환","replace"].includes(m)) return "그대로";
  if (["앞","전","prefix","시작"].includes(m)) return "앞";
  if (["끝","후","suffix","종결"].includes(m)) return "끝";
  if (["정규식","regex","re","re.sub"].includes(m)) return "정규식";
  return m ? "그대로" : "그대로";
}

function extractCondFromNote(note) {
  // 비고에 조건=...이 있으면 추출
  const m = /조건\s*=\s*([^\n\r]+)/.exec(note || "");
  if (!m) return "";
  let c = m[1];
  c = c.replace(/에서쓰일때|에서쓸때|쓸때|일때/g, "");
  c = c.replace(/[‘’'"\s]/g, "");
  return c.trim();
}

function cleanupCond(cond) {
  return (cond || "")
    .replace(/에서쓰일때|에서쓸때|쓸때|일때/g, "")
    .replace(/[‘’'"\s]/g, "")
    .trim();
}

// -------------------------
// 3) 조건 판정 (자음뒤/모음뒤/양성모음뒤/음성모음뒤/ㅣ모음뒤/ㅣ외의모음뒤 + and/or)
// -------------------------
const JUNG_LIST = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const YANG_JUNG = new Set(["ㅏ","ㅑ","ㅗ","ㅛ","ㅘ","ㅙ","ㅚ"]);
const EUM_JUNG  = new Set(["ㅓ","ㅕ","ㅜ","ㅠ","ㅡ","ㅝ","ㅞ","ㅟ","ㅢ"]);

function isHangulSyllable(ch) {
  if (!ch) return false;
  const o = ch.codePointAt(0);
  return o >= 0xAC00 && o <= 0xD7A3;
}

function getJongIndex(ch) {
  if (!isHangulSyllable(ch)) return -1;
  const code = ch.codePointAt(0) - 0xAC00;
  return code % 28; // 0이면 받침 없음
}

function getJung(ch) {
  if (!isHangulSyllable(ch)) return "";
  const code = ch.codePointAt(0) - 0xAC00;
  const jungIdx = Math.floor(code / 28) % 21;
  return JUNG_LIST[jungIdx] || "";
}

function parseCondExpr(cond) {
  const c = cleanupCond(cond);
  if (!c) return [];
  const orParts = c.split(/(?:or|OR|Or)/);
  return orParts
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.split(/(?:and|AND|And)/).filter(Boolean));
}

function checkOneToken(token, text, idx) {
  token = cleanupCond(token);
  const prev = idx > 0 ? text[idx-1] : "";

  if (token === "자음뒤") return getJongIndex(prev) > 0;
  if (token === "모음뒤") return getJongIndex(prev) === 0;

  if (token === "양성모음뒤") return YANG_JUNG.has(getJung(prev));
  if (token === "음성모음뒤") return EUM_JUNG.has(getJung(prev));

  if (token === "ㅣ모음뒤" || token === "중성모음ㅣ뒤") return getJung(prev) === "ㅣ";

  if (token === "ㅣ외의모음뒤" || token === "ㅣ외모음뒤") {
    const jong = getJongIndex(prev);
    const jung = getJung(prev);
    return jong === 0 && jung && jung !== "ㅣ";
  }

  // 모르는 조건은 False(보수적)
  return false;
}

function checkCond(cond, text, idx) {
  const expr = parseCondExpr(cond);
  if (expr.length === 0) return true;

  // OR: 하나라도 통과하면 OK
  for (const andTokens of expr) {
    let ok = true;
    for (const t of andTokens) {
      if (!checkOneToken(t, text, idx)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// -------------------------
// 4) 번역 로직 (조건이 있으면 위치별 검사 후 치환)
// -------------------------
function splitSrcAlternatives(src) {
  if (/(?:or|OR|Or)/.test(src)) {
    return src.split(/(?:or|OR|Or)/).map(s => s.trim()).filter(Boolean);
  }
  return [src];
}

function conditionalReplace(text, src, dst, cond) {
  if (!src) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(src, i) && checkCond(cond, text, i)) {
      out += dst;
      i += src.length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

function applyPrefixSuffix(text, src, dst, mode) {
  // 공백 기준 안전형. (원하면 문장부호 토큰화 버전으로 업그레이드 가능)
  const words = text.split(" ");
  const out = words.map(w => {
    if (mode === "앞" && w.startsWith(src)) return dst + w.slice(src.length);
    if (mode === "끝" && w.endsWith(src)) return w.slice(0, -src.length) + dst;
    return w;
  });
  return out.join(" ");
}

function translate(text, rules, debug=false) {
  // 웹에서도 NFC 정규화로 안정성 확보
  text = text.normalize("NFC");

  for (const r of rules) {
    const alts = splitSrcAlternatives(r.src);
    const before = text;

    if (r.mode === "그대로") {
      for (const src of alts) {
        text = r.cond ? conditionalReplace(text, src, r.dst, r.cond)
                      : text.split(src).join(r.dst);
      }
    } else if (r.mode === "앞" || r.mode === "끝") {
      for (const src of alts) {
        // 앞/끝은 cond를 무시(안전). 원하면 확장 가능.
        text = applyPrefixSuffix(text, src, r.dst, r.mode);
      }
    } else if (r.mode === "정규식") {
      if (r.cond) {
        // 조건이 있으면 안전하게 "문자열 매칭 + 조건 검사"로 처리
        for (const src of alts) {
          text = conditionalReplace(text, src, r.dst, r.cond);
        }
      } else {
        // cond 없으면 src를 정규식으로 해석
        try {
          const re = new RegExp(r.src, "g");
          text = text.replace(re, r.dst);
        } catch (e) {
          // 정규식이 깨지면 fallback
          text = text.split(r.src).join(r.dst);
        }
      }
    }

    if (debug && text !== before) {
      console.log(`[APPLIED] (${r.priority}) ${r.mode}${r.cond ? " cond="+r.cond : ""}: '${r.src}' -> '${r.dst}'`);
    }
  }
  return text;
}
app
