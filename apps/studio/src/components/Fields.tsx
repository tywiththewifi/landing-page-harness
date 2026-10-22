import { useEffect, useState } from "react";
import styles from "./Fields.module.scss";

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({ label, value, onChange }: { label?: string; value: string | null; onChange: (v: string) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const commit = (v: string) => {
    const hex = v.startsWith("#") ? v : `#${v}`;
    if (HEX.test(hex)) onChange(hex.toLowerCase());
    else setText(value ?? "");
  };
  return (
    <label className={styles.field}>
      {label ? <span className="ui-label">{label}</span> : null}
      <span className={styles.color}>
        <input
          type="color"
          aria-label={label ? `${label} picker` : "Colour picker"}
          value={value && HEX.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="ui-input"
          value={text}
          placeholder="none"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value.trim())}
        />
      </span>
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  unit = "px",
  step = 1,
  min,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
}) {
  return (
    <label className={styles.field}>
      <span className="ui-label">{label}</span>
      <span className={styles.number}>
        <input
          className="ui-input"
          type="number"
          step={step}
          min={min}
          value={value ?? ""}
          onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </span>
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.field}>
      <span className="ui-label">{label}</span>
      <input className="ui-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };

export function WeightField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = WEIGHTS.includes(value) ? WEIGHTS : [...WEIGHTS, value].sort((a, b) => a - b);
  return (
    <label className={styles.field}>
      <span className="ui-label">Weight</span>
      <select className="ui-input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((w) => (
          <option key={w} value={w}>
            {w} {WEIGHT_NAMES[w] ?? ""}
          </option>
        ))}
      </select>
    </label>
  );
}
