// 吊り架台の図面（SVG）＋ タップ編集チップ（HTML重ね）。
// Flutter版 HangerDrawingScreen の図（Stack: CustomPaint + Positioned編集チップ）を移植。
// onEdit を渡すと、水色のチップをタップして寸法・配管を編集できる（図から寸法入力）。
// onEdit 省略時は静的表示（PDFスナップショット等に再利用可）。

import React from 'react';
import {
  HangerDesign,
  HoleSpec,
  compute,
  legendSpecs,
  specForHole,
  holeColor,
  holeNotation,
} from './hangerDesign';
import { fmtMm } from './supportSpec';

// レイアウト（固定キャンバス 820×300）
const W = 820;
const H = 300;
const PAD_L = 40;
const PAD_R = 40;
const Y_HANGER = 78;
const Y_CENTER = 112;
const BAR_TOP = 146;
const BAR_H = 34;
const BAR_BOTTOM = BAR_TOP + BAR_H;
const Y_HOLES = 210;
const Y_TOTAL = 244;

const COL_LINE = '#222222';
const COL_THIN = '#8a8a8a';
const EDIT = '#1565C0';

/** タップ編集の対象。 */
export type EditTarget =
  | { kind: 'gauge' }
  | { kind: 'span'; index: number }
  | { kind: 'end'; side: 'L' | 'R' }
  | { kind: 'hg'; side: 'L' | 'R' }
  | { kind: 'hangerPitch' }
  | { kind: 'refToPipe'; side: 'L' | 'R' }
  | { kind: 'pipe'; index: number };

type El = React.ReactNode;

function txt(
  key: string,
  x: number,
  y: number,
  s: string,
  opts: { size?: number; bold?: boolean; color?: string; center?: boolean } = {}
): El {
  const { size = 11, bold, color = '#222', center } = opts;
  return (
    <text
      key={key}
      x={x}
      y={y}
      fontSize={size}
      fontWeight={bold ? 700 : 400}
      fill={color}
      textAnchor={center ? 'middle' : 'start'}
      dominantBaseline="hanging"
      fontFamily="sans-serif"
    >
      {s}
    </text>
  );
}

function arrowH(key: string, tipX: number, y: number, dir: 1 | -1): El {
  return (
    <polyline key={key} points={`${tipX + 6 * dir},${y - 3} ${tipX},${y} ${tipX + 6 * dir},${y + 3}`} fill="none" stroke={COL_LINE} strokeWidth={1} />
  );
}
function arrowV(key: string, x: number, tipY: number, dir: 1 | -1): El {
  return (
    <polyline key={key} points={`${x - 3},${tipY + 6 * dir} ${x},${tipY} ${x + 3},${tipY + 6 * dir}`} fill="none" stroke={COL_LINE} strokeWidth={1} />
  );
}
function dashedCircle(key: string, cx: number, cy: number, r: number, color: string): El {
  return <circle key={key} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.1} strokeDasharray="2 2" />;
}
function holeMark(key: string, cx: number, cy: number, spec: HoleSpec, through: boolean): El[] {
  const els: El[] = [];
  const color = holeColor(spec);
  if (spec.slot) {
    els.push(<rect key={`${key}-r`} x={cx - 6} y={cy - 2.5} width={12} height={5} rx={2.5} fill="#fff" stroke={color} strokeWidth={1.1} />);
  } else {
    els.push(<circle key={`${key}-c`} cx={cx} cy={cy} r={4} fill="#fff" stroke={color} strokeWidth={1.1} />);
  }
  if (through) els.push(dashedCircle(`${key}-t`, cx, cy, 2.3, color));
  return els;
}

interface Chip {
  key: string;
  cx: number; // SVG座標
  cy: number;
  text: string;
  target: EditTarget;
}

export interface SupportFigureProps {
  design: HangerDesign;
  onEdit?: (t: EditTarget) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function SupportFigure({ design: d, onEdit, className, style }: SupportFigureProps): JSX.Element {
  const interactive = !!onEdit;
  const r = compute(d);
  const total = r.totalLength;
  const svg: El[] = [];
  const chips: Chip[] = [];

  if (total <= 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} style={style} width="100%">
        {txt('empty', PAD_L, 20, '配管を入力してください', { size: 14, bold: true })}
      </svg>
    );
  }

  const scale = (W - PAD_L - PAD_R) / total;
  const xOf = (mm: number) => PAD_L + mm * scale;

  // ラベル：編集可なら chip、そうでなければ SVG テキスト
  const label = (key: string, cx: number, cyTop: number, text: string, target: EditTarget | null, size = 10) => {
    if (interactive && target) {
      chips.push({ key, cx, cy: cyTop + size / 2, text, target });
    } else {
      svg.push(txt(key, cx, cyTop, text, { size, center: true }));
    }
  };

  // ヘッダー
  const material = d.memberChannel ? 'チャンネル' : 'アングル';
  const dir = d.memberChannel ? '背向き' : '刃向き';
  const blade = `　${dir}:${d.bladeTop ? '奥' : '手前'}`;
  const hangerNote = d.hasHanger ? '' : '　吊り穴なし';
  svg.push(txt('hdr', PAD_L, 8, `${material}　${d.modeB ? '吊り元基準' : '配管芯々基準'}${blade}${hangerNote}`, { size: 13, bold: true }));

  // 凡例
  {
    let lx = PAD_L;
    const ly = 28;
    svg.push(txt('lg', lx, ly, '穴:', { size: 10 }));
    lx += 18;
    let k = 0;
    for (const e of legendSpecs(d)) {
      const cy = ly + 5;
      const color = holeColor(e.spec);
      if (e.spec.slot) {
        svg.push(<rect key={`lgm-${k}`} x={lx} y={cy - 2} width={10} height={4} rx={2} fill="none" stroke={color} strokeWidth={1.1} />);
      } else {
        svg.push(<circle key={`lgm-${k}`} cx={lx + 5} cy={cy} r={3.5} fill="none" stroke={color} strokeWidth={1.1} />);
      }
      lx += 14;
      const t = `${e.key} ${holeNotation(e.spec)}`;
      svg.push(txt(`lgt-${k}`, lx, ly, t, { size: 10, color }));
      lx += t.length * 6.5 + 12;
      k++;
    }
  }

  // バー
  svg.push(<rect key="bar" x={xOf(0)} y={BAR_TOP} width={xOf(total) - xOf(0)} height={BAR_H} fill="none" stroke={COL_LINE} strokeWidth={1} />);

  // 刃/背 破線
  const dashY = d.bladeTop ? BAR_TOP + 4 : BAR_BOTTOM - 4;
  svg.push(<line key="blade" x1={xOf(0)} y1={dashY} x2={xOf(total)} y2={dashY} stroke={COL_LINE} strokeWidth={1} strokeDasharray="6 4" />);

  // ゲージ基準エッジ
  const refTop = d.memberChannel ? d.bladeTop : !d.bladeTop;
  const edgeY = refTop ? BAR_TOP : BAR_BOTTOM;
  const holeY = refTop ? BAR_TOP + BAR_H * 0.62 : BAR_BOTTOM - BAR_H * 0.62;

  // 穴・吊り記号
  r.holes.forEach((h, i) => {
    const cx = xOf(h.x);
    const spec = specForHole(d, h);
    const through = d.memberChannel && h.isHanger;
    holeMark(`hole-${i}`, cx, holeY, spec, through).forEach((e) => svg.push(e));
    if (h.isHanger) {
      svg.push(<line key={`rod-${i}`} x1={cx} y1={BAR_TOP} x2={cx} y2={BAR_TOP - 14} stroke={COL_LINE} strokeWidth={1} />);
      svg.push(<line key={`rodt-${i}`} x1={cx - 5} y1={BAR_TOP - 13} x2={cx + 5} y2={BAR_TOP - 13} stroke={COL_LINE} strokeWidth={1} />);
    }
  });

  // ゲージ寸法（チップで編集）
  if (r.holes.length > 0) {
    const xg = xOf(r.holes[0].x) - 16;
    svg.push(<line key="gv" x1={xg} y1={edgeY} x2={xg} y2={holeY} stroke={COL_LINE} strokeWidth={1} />);
    svg.push(arrowV('gva', xg, edgeY, 1));
    svg.push(arrowV('gvb', xg, holeY, -1));
    const gtext = `${d.memberChannel ? '背' : '刃'}${fmtMm(d.gauge)}`;
    if (interactive) {
      chips.push({ key: 'gauge', cx: xg - 12, cy: (edgeY + holeY) / 2, text: gtext, target: { kind: 'gauge' } });
    } else {
      svg.push(txt('gvt', xg - 34, (edgeY + holeY) / 2 - 6, gtext, { size: 11, bold: true }));
    }
  }

  const hangers = r.holes.filter((h) => h.isHanger);
  const hL = hangers.length ? hangers[0].x : 0;
  const hR = hangers.length ? hangers[hangers.length - 1].x : total;
  const n = r.pipeCenters.length;

  // 下段：穴チェーン
  const st = [0, ...r.holes.map((h) => h.x), total];
  const kinds = [0, ...r.holes.map((h) => (h.isHanger ? 1 : 2)), 0];
  st.forEach((s, i) => {
    svg.push(<line key={`hx-${i}`} x1={xOf(s)} y1={BAR_BOTTOM} x2={xOf(s)} y2={Y_HOLES + 5} stroke={COL_THIN} strokeWidth={0.7} />);
  });
  for (let i = 0; i < st.length - 1; i++) {
    const x1 = xOf(st[i]);
    const x2 = xOf(st[i + 1]);
    svg.push(<line key={`hd-${i}`} x1={x1} y1={Y_HOLES} x2={x2} y2={Y_HOLES} stroke={COL_LINE} strokeWidth={1} />);
    svg.push(arrowH(`hda-${i}`, x1, Y_HOLES, 1));
    svg.push(arrowH(`hdb-${i}`, x2, Y_HOLES, -1));
    const a = kinds[i];
    const b = kinds[i + 1];
    const isEndHanger = (a === 0 && b === 1) || (a === 1 && b === 0);
    const isEndUhole = !d.hasHanger && ((a === 0 && b === 2) || (a === 2 && b === 0));
    const isHangerHole = (a === 1 && b === 2) || (a === 2 && b === 1);
    let target: EditTarget | null = null;
    if (isEndHanger || isEndUhole) target = { kind: 'end', side: i === 0 ? 'L' : 'R' };
    else if (isHangerHole && !d.modeB) target = { kind: 'hg', side: i < st.length / 2 ? 'L' : 'R' };
    const ty = Y_HOLES - 12 - (i % 2 === 1 ? 10 : 0);
    label(`hdt-${i}`, (x1 + x2) / 2, ty, fmtMm(st[i + 1] - st[i]), target, 11);
  }

  // 切り寸
  svg.push(<line key="tl0" x1={xOf(0)} y1={BAR_BOTTOM} x2={xOf(0)} y2={Y_TOTAL} stroke={COL_THIN} strokeWidth={0.7} />);
  svg.push(<line key="tl1" x1={xOf(total)} y1={BAR_BOTTOM} x2={xOf(total)} y2={Y_TOTAL} stroke={COL_THIN} strokeWidth={0.7} />);
  svg.push(<line key="tld" x1={xOf(0)} y1={Y_TOTAL} x2={xOf(total)} y2={Y_TOTAL} stroke={COL_LINE} strokeWidth={1} />);
  svg.push(arrowH('tla', xOf(0), Y_TOTAL, 1));
  svg.push(arrowH('tlb', xOf(total), Y_TOTAL, -1));
  svg.push(txt('tlt', (xOf(0) + xOf(total)) / 2, Y_TOTAL - 16, `切り寸 ${fmtMm(total)}`, { size: 15, bold: true, center: true }));

  // 中段チェーン
  const center = d.modeB ? [hL, ...r.pipeCenters, hR] : [...r.pipeCenters];
  if (center.length >= 2) {
    center.forEach((s, i) => {
      svg.push(<line key={`cx-${i}`} x1={xOf(s)} y1={BAR_TOP} x2={xOf(s)} y2={Y_CENTER + 5} stroke={COL_THIN} strokeWidth={0.7} />);
    });
    for (let i = 0; i < center.length - 1; i++) {
      const v = center[i + 1] - center[i];
      const x1 = xOf(center[i]);
      const x2 = xOf(center[i + 1]);
      svg.push(<line key={`cd-${i}`} x1={x1} y1={Y_CENTER} x2={x2} y2={Y_CENTER} stroke={COL_LINE} strokeWidth={1} />);
      svg.push(arrowH(`cda-${i}`, x1, Y_CENTER, 1));
      svg.push(arrowH(`cdb-${i}`, x2, Y_CENTER, -1));
      let target: EditTarget | null = null;
      let text = fmtMm(v);
      if (d.modeB) {
        const isPipePair = i >= 1 && i <= n - 1;
        if (isPipePair) {
          target = { kind: 'span', index: i - 1 };
          text = `芯々${fmtMm(v)}`;
        } else {
          target = { kind: 'refToPipe', side: i === 0 ? 'L' : 'R' };
        }
      } else {
        target = { kind: 'span', index: i };
        text = `芯々${fmtMm(v)}`;
      }
      label(`cdt-${i}`, (x1 + x2) / 2, Y_CENTER - 15, text, target, 12);
    }
  }

  // 上段：吊り元芯々
  if (hangers.length >= 2) {
    svg.push(<line key="hh0" x1={xOf(hL)} y1={Y_CENTER} x2={xOf(hL)} y2={Y_HANGER} stroke={COL_THIN} strokeWidth={0.7} />);
    svg.push(<line key="hh1" x1={xOf(hR)} y1={Y_CENTER} x2={xOf(hR)} y2={Y_HANGER} stroke={COL_THIN} strokeWidth={0.7} />);
    svg.push(<line key="hhd" x1={xOf(hL)} y1={Y_HANGER} x2={xOf(hR)} y2={Y_HANGER} stroke={COL_LINE} strokeWidth={1} />);
    svg.push(arrowH('hha', xOf(hL), Y_HANGER, 1));
    svg.push(arrowH('hhb', xOf(hR), Y_HANGER, -1));
    const t = `吊元芯々 ${fmtMm(hR - hL)}`;
    label('hht', (xOf(hL) + xOf(hR)) / 2, Y_HANGER - 15, t, d.modeB ? { kind: 'hangerPitch' } : null, 12);
  }

  // 配管ラベル（タップで配管編集）
  r.pipeCenters.forEach((c, i) => {
    const t = `${d.pipeSizes[i]}${d.sleepers[i] > 0 ? ` T${d.sleepers[i]}` : ''}`;
    if (interactive) {
      chips.push({ key: `pl-${i}`, cx: xOf(c), cy: BAR_TOP + BAR_H / 2, text: t, target: { kind: 'pipe', index: i } });
    } else {
      svg.push(txt(`pl-${i}`, xOf(c), BAR_TOP + BAR_H / 2 - 7, d.pipeSizes[i], { size: 13, bold: true, center: true }));
    }
  });

  // 高低差の表（右上）
  heightTable(d, r).forEach((e) => svg.push(e));

  const svgEl = (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      {svg}
    </svg>
  );

  if (!interactive) {
    return (
      <div className={className} style={style}>
        {svgEl}
      </div>
    );
  }

  // タップ編集チップを % 座標で重ねる。
  // 幅を画面幅に合わせて縮めてしまうと文字・チップが現場で読めないほど
  // 小さくなるため、W(=820)px を実寸の下限にして自然な大きさを保つ。
  // 画面より広い分は親側(.support-figure-card)の横スクロールに任せる。
  return (
    <div
      className={className}
      style={{ position: 'relative', width: W, minWidth: W, aspectRatio: `${W} / ${H}`, ...style }}
    >
      {svgEl}
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => onEdit!(c.target)}
          style={{
            position: 'absolute',
            left: `${(c.cx / W) * 100}%`,
            top: `${(c.cy / H) * 100}%`,
            transform: 'translate(-50%, -50%)',
            padding: '4px 9px',
            borderRadius: 8,
            border: 'none',
            background: EDIT,
            color: '#fff',
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {c.text}
        </button>
      ))}
    </div>
  );
}

function heightTable(d: HangerDesign, r: ReturnType<typeof compute>): El[] {
  const heights = r.pipeCenterHeights;
  if (heights.length === 0) return [];
  let refMax = heights[0];
  for (const h of heights) if (h > refMax) refMax = h;

  const seen = new Set<string>();
  const rows: Array<{ label: string; value: number }> = [];
  for (let i = 0; i < heights.length; i++) {
    const key = `${d.pipeSizes[i]}|${d.sleepers[i]}`;
    if (!seen.has(key)) {
      seen.add(key);
      const label = d.sleepers[i] > 0 ? `${d.pipeSizes[i]} T${d.sleepers[i]}` : d.pipeSizes[i];
      rows.push({ label, value: heights[i] });
    }
  }
  if (rows.length < 2) return [];

  const x = W - 150;
  let y = 4;
  const els: El[] = [];
  els.push(txt('ht-h', x, y, '高低差(一番高い=0)', { size: 10, bold: true }));
  y += 14;
  rows.forEach((row, i) => {
    els.push(txt(`ht-l-${i}`, x, y, row.label, { size: 11 }));
    const isTop = row.value >= refMax - 0.001;
    els.push(txt(`ht-v-${i}`, x + 58, y, isTop ? '0' : `−${fmtMm(refMax - row.value)}`, { size: 11, bold: true, color: isTop ? '#000' : '#c62828' }));
    y += 14;
  });
  return els;
}
