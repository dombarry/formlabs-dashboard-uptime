import type { Metadata } from "next";
import Link from "next/link";
import appInfo from "@/public/downloads/mac-app.json";

export const metadata: Metadata = {
  title: "Mac Menu Bar App · Formlabs Dashboard Status",
};

const sizeKb = Math.round(appInfo.bytes / 1024);

export default function MacPage() {
  return (
    <main>
      <p className="small">
        <Link href="/">← Back to status</Link>
      </p>
      <header>
        <h1>Dashboard status in your menu bar</h1>
        <p className="muted">
          A small Mac app that puts a coloured dot in your menu bar showing whether Formlabs Dashboard is up, and
          notifies you when it goes down or recovers.
        </p>
      </header>

      <section className="card download">
        <div className="legend">
          <span><span className="dot up" /> Operational</span>
          <span><span className="dot degraded" /> Slow</span>
          <span><span className="dot down" /> Down</span>
          <span><span className="dot" /> Unknown</span>
        </div>
        <a className="btn" href="/downloads/DashboardStatus.zip" download>
          Download for Mac
        </a>
        <div className="muted small">
          Version {appInfo.version} · {sizeKb} KB · macOS 13 Ventura or later · Apple silicon and Intel
        </div>
      </section>

      <h2>Install</h2>
      <ol className="steps">
        <li>
          <strong>Download</strong> the zip above. Safari unzips it automatically; in Chrome, double-click{" "}
          <code>DashboardStatus.zip</code> in your Downloads folder.
        </li>
        <li>
          <strong>Drag &ldquo;Dashboard Status&rdquo; into your Applications folder.</strong>
        </li>
        <li>
          <strong>Open it from Applications.</strong> The first time, macOS shows a warning because the app isn&apos;t
          from the App Store. That&apos;s expected. Click <em>Done</em> (or <em>Cancel</em>), then:
          <ul>
            <li>
              <strong>macOS 15 Sequoia and later:</strong> open <em>System Settings → Privacy &amp; Security</em>,
              scroll down to the message about &ldquo;Dashboard Status&rdquo; and click <em>Open Anyway</em>. Enter
              your password if asked, then click <em>Open Anyway</em> again.
            </li>
            <li>
              <strong>macOS 13–14:</strong> right-click the app in Applications, choose <em>Open</em>, then click{" "}
              <em>Open</em> in the dialog.
            </li>
          </ul>
          You only need to do this once.
        </li>
        <li>
          <strong>Look for the dot</strong> near the clock in your menu bar. Click it to see each check, open this
          page, or open Dashboard.
        </li>
        <li>
          <strong>Allow notifications</strong> when asked, so you get an alert when Dashboard goes down or comes back.
        </li>
        <li>
          <strong>Optional:</strong> click the dot and turn on <em>Launch at Login</em> so it starts automatically.
        </li>
      </ol>

      <h2>Troubleshooting</h2>
      <dl className="faq">
        <dt>I can&apos;t see the dot</dt>
        <dd>
          On MacBooks with a notch, menu bar icons get hidden when there isn&apos;t room. Quit a few other menu bar apps
          to make space. On macOS 26, also check <em>System Settings → Menu Bar</em> and make sure Dashboard Status is
          allowed.
        </dd>
        <dt>&ldquo;Dashboard Status is damaged and can&apos;t be opened&rdquo;</dt>
        <dd>
          macOS sometimes shows this for apps downloaded outside the App Store. Run this in Terminal, then open the app
          again:
          <pre>xattr -dr com.apple.quarantine &quot;/Applications/Dashboard Status.app&quot;</pre>
        </dd>
        <dt>The dot is grey</dt>
        <dd>
          The app can&apos;t reach this status site, or the checker hasn&apos;t run recently. Check your internet
          connection, or click the dot and choose <em>Refresh Now</em>.
        </dd>
        <dt>Updating</dt>
        <dd>
          Status rules are decided by this site, so you don&apos;t need to update the app when they change. If a new
          version is posted here, quit the app, download it again and replace the copy in Applications.
        </dd>
        <dt>Uninstalling</dt>
        <dd>Click the dot, choose Quit, then drag Dashboard Status from Applications to the Trash.</dd>
      </dl>
    </main>
  );
}
