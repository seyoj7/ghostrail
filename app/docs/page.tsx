import "./page.css";
import { Nav } from "../components/ui/Nav";

export default function DocsPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <main className="docs-page">
          {/* Docs page content will be added here */}
        </main>
      </div>
    </div>
  );
}
