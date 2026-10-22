import { Link, Outlet } from "react-router";
import styles from "./Shell.module.scss";

export function Shell() {
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
          <span className={styles.current}>1 Brand</span>
          <span>2 Brief</span>
          <span>3 Page</span>
          <span>4 Publish</span>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
