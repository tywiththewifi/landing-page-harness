import { Link, Outlet, useLocation } from "react-router";
import styles from "./Shell.module.scss";

const STEPS = ["Brand", "Brief", "Page", "Publish"];

export function Shell() {
  const { pathname } = useLocation();
  const step = pathname.endsWith("/publish") ? 3 : pathname.startsWith("/pages/") ? 2 : pathname.startsWith("/briefs/") || pathname.endsWith("/briefs/new") ? 1 : 0;
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link to="/" className={styles.brand}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1" y="1" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 9h8M9 5v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          landing-page-harness
        </Link>
        <nav className={styles.steps} aria-label="Steps">
          {STEPS.map((s, i) => (
            <span key={s} className={i === step ? styles.current : i < step ? styles.past : undefined} aria-current={i === step ? "step" : undefined}>
              {i + 1} {s}
            </span>
          ))}
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
