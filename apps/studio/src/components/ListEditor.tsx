import type { ReactNode } from "react";
import styles from "./ListEditor.module.scss";

/** An editable, reorderable list. Each item renders its own fields. */
export function ListEditor<T>({
  items,
  onChange,
  render,
  create,
  addLabel,
  label,
  min = 0,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, set: (next: T) => void, index: number) => ReactNode;
  create: () => T;
  addLabel: string;
  /** Names an item for screen readers, e.g. "Message 2". */
  label: (index: number) => string;
  min?: number;
}) {
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className={styles.list}>
      {items.map((item, i) => (
        <div key={i} className={styles.item} role="group" aria-label={label(i)}>
          <div className={styles.controls}>
            <span className={styles.index}>{i + 1}</span>
            <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${label(i)} up`} title="Move up">
              ↑
            </button>
            <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={`Move ${label(i)} down`} title="Move down">
              ↓
            </button>
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} disabled={items.length <= min} aria-label={`Remove ${label(i)}`} title="Remove">
              ✕
            </button>
          </div>
          <div className={styles.body}>{render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}</div>
        </div>
      ))}
      <button type="button" className="ui-button ui-button--small" onClick={() => onChange([...items, create()])}>
        + {addLabel}
      </button>
    </div>
  );
}

/** One line per entry, for short lists like pains or keywords. */
export function StringList({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  return (
    <div className={styles.strings} role="group" aria-label={label}>
      <span className="ui-label">{label}</span>
      {items.map((value, i) => (
        <div key={i} className={styles.stringRow}>
          <input
            className="ui-input"
            value={value}
            placeholder={placeholder}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className="ui-button ui-button--ghost ui-button--small" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} ${i + 1}`}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.addLine} onClick={() => onChange([...items, ""])}>
        + Add
      </button>
    </div>
  );
}
