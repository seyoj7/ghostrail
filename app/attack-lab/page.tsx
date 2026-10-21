import "./page.css";
import { Nav } from "../components/ui/Nav";

export default function AttackLabPage() {
  return (
    <div className="pg">
      <div className="in">
        <Nav />
        <h2 className="attack-lab-heading">Attack lab</h2>
        <p className="mut attack-lab-subtitle">
          No live attack scenarios are configured. Results will appear here
          when connected to real facilitator requests.
        </p>
      </div>
    </div>
  );
}
