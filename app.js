// app.js
// 현대국어 → 중세국어 변환기 (rules.csv 기반, 웹버전)
// - (구) 현대어,중세어,적용방식,우선순위,비고
// - (신) 현대어,중세어,적용방식,조건,우선순위,비고
// - 비고에서 "조건=..."도 추출
// - 조건(and/or): 자음뒤/모음뒤/양성모음뒤/음성모음뒤/ㅣ모음뒤/ㅣ외의모음뒤

let RULES = []; // {src,dst,mode,priority,cond,note}

document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const inputEl  = document.getElementById("inputText");
  const outputEl = document.getElementById("outputText");
  const debugEl  = document.getElementById("debugMode");

  const btnTranslate = document.getElementById("btnTranslate");
  const btnReload    = document.getElementById("btnReload");
  const ruleFile     = document.getElementById("ruleFile");

  // 필수 요소 확인(HTML id 오타 방지)
  if (!statusEl || !inputEl || !outputEl || !btnTranslate || !btnReload || !ruleFile) {
    console.error("필수 HTML 요소를 찾을 수 없습니다. id를 확인하세요.");
    return;
  }

  btnTranslate.addEventListener("click", () => {
    const src = inputEl.value || "";
    outputEl.value = translate(src, RULES, debugEl ? debugEl.checked : false);
  });

  btnReload.addEventListener("click", async () => {
    await loadRulesFromRepo(statusEl);
  });

  ruleFile.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    RULES = parseRulesCSV(text);
    statusEl.textContent = `업로드 규칙 로드 완료: ${RULES.length}개`;
  });

  // 초기 로드
  loadRulesFromRepo(statusEl);
});

// -------------------------
// 1) rules.csv 로드 (repo에 있는 파일)
// -------------------------
async function loadRulesFromRepo(statusEl) {
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
// 헤더가 없거나 깨져도 최대한 복구
// -------------------------
function parseRulesCSV(csvText) {
  const rows = splitCSV(csvText);
  if (rows.length === 0) return [];

  // 첫 줄이 헤더인지 판별(현대어/중세어/적용방식 같은 키가 있으면 헤더로 간주)
  const first = rows[0].map(x => (x ?? "").trim());
  const looksHeader = first.includes("현대어") || first.includes("중세어") || first.includes("적용방식");

  let header = [];
  let startRow = 0;

  if (looksHeader) {
    header = first.map(h => h.trim());
    startRow = 1;
  } else {
    // 헤더가 없으면 구버전 5열로 가정
    header = ["현대어", "중세어", "적용방식", "우선순위", "비고"];
    startRow = 0;
  }

  const idx = (name) => header.indexOf(name);
  const hasCondCol = idx("조건") !== -1;

  const out = [];
  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(x => (x ?? "").trim() === "")) continue;

    // 안전한 가져오기: 헤더가 있든 없든 최대한 맞춰 읽기
    const src = (getCell(r, idx("현대어"), 0) ?? "").trim();
    const dst = (getCell(r, idx("중세어"), 1) ?? "").trim();
    const modeRaw = (getCell(r, idx("적용방식"), 2) ?? "").trim();
    const mode = normalizeMode(modeRaw);

    let priorityRaw = (getCell(r, idx("우선순위"), hasCondCol ? 4 : 3) ?? "").trim();
    let priority = parseInt(priorityRaw, 10);
    if (Number.isNaN(priority)) priority = 0;

    const note = (getCell(r, idx("비고"), hasCondCol ? 5 : 4) ?? "").trim();

    let cond = "";
    if (hasCondCol) cond = (getCell(r, idx("조건"), 3) ?? "").trim();
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

function getCell(row, headerIndex, fallbackIndex) {
  if (headerIndex !== -1) return row[headerIndex];
  return row[fallbackIndex];
}

// 아주 단순 CSV split (따옴표 포함 처리)
function splitCSV(text) {
  const norm = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = norm.split("\n");
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
    if (ch === '"') {
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
  const s = (m || "").trim();
  if (["그대로","일반","치환","replace"].includes(s)) return "그대로";
  if (["앞","전","prefix","시작"].includes(s)) return "앞";
  if (["끝","후","suffix","종결"].includes(s)) return "끝";
  if (["정규식","regex","re","re.sub"].includes(s)) return "정규식";
  // 모르는 값은 보수적으로 그대로
  return s ? "그대로" : "그대로";
}

function extractCondFromNote(note) {
  // 비고에 조건=...이 있으면 추출(한 줄 전체를 먹되 후처리로 정리)
  const m = /조건\s*=\s*([^\n\r]+)/.exec(note || "");
  if (!m) return "";
  return cleanupCond(m[1]);
}

function cleanupCond(cond) {
  return (cond || "")
    .replace(/에서쓰일때|에서쓸때|쓸때|일때/g, "")
    .replace(/[‘’'" \t]/g, "")
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

// cond를 OR(여러 묶음) -> AND(토큰들) 구조로 파싱
function parseCondExpr(cond) {
  const c = cleanupCond(cond);
  if (!c) return [];
  const orParts = c.split(/(?:or|OR|Or)/);
  return orParts
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.split(/(?:and|AND|And)/).map(x=>x.trim()).filter(Boolean));
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
// 4) 번역 로직
// - src에 "or"가 있으면 대안 목록으로 분리
// - cond가 있으면 위치별 검사 후 치환(안전)
// - 앞/끝은 문장부호 보존 토큰화로 개선
// -------------------------
function splitSrcAlternatives(src) {
  const s = (src || "").trim();
  if (!s) return [];
  if (/(?:or|OR|Or)/.test(s)) {
    return s.split(/(?:or|OR|Or)/).map(x => x.trim()).filter(Boolean);
  }
  return [s];
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

// 문장부호/공백을 보존하는 토큰화
function tokenizeKeepPunct(text) {
  return (text || "").match(/\w+|[^\w\s]+|\s+/gu) || [];
}

function applyPrefixSuffix(text, src, dst, mode) {
  const tokens = tokenizeKeepPunct(text);
  const out = [];

  for (const tok of tokens) {
    // 공백 또는 문장부호는 그대로
    if (/^\s+$/u.test(tok) || /^[^\w\s]+$/u.test(tok)) {
      out.push(tok);
      continue;
    }

    let w = tok;
    if (mode === "앞" && w.startsWith(src)) w = dst + w.slice(src.length);
    else if (mode === "끝" && w.endsWith(src)) w = w.slice(0, -src.length) + dst;
    out.push(w);
  }

  return out.join("");
}

function translate(text, rules, debug=false) {
  text = (text || "").normalize("NFC");

  for (const r of (rules || [])) {
    const alts = splitSrcAlternatives(r.src);
    if (alts.length === 0) continue;

    const before = text;

    if (r.mode === "그대로") {
      for (const src of alts) {
        text = r.cond
          ? conditionalReplace(text, src, r.dst, r.cond)
          : text.split(src).join(r.dst);
      }

    } else if (r.mode === "앞" || r.mode === "끝") {
      for (const src of alts) {
        // 앞/끝도 cond를 적용하고 싶으면 확장 가능하지만, 우선 안전형으로는 무시
        text = applyPrefixSuffix(text, src, r.dst, r.mode);
      }

    } else if (r.mode === "정규식") {
      if (r.cond) {
        // 조건이 있으면 안전하게 "문자열 매칭 + 조건 검사"
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
      console.log(
        `[APPLIED] (${r.priority}) ${r.mode}${r.cond ? " cond="+r.cond : ""}: '${r.src}' -> '${r.dst}'`
      );
    }
  }

  return text;
}
