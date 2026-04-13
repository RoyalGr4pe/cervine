import { ControlsPane } from "./components/ControlsPane";
import { PreviewPane } from "./components/PreviewPane";
import { PerfHud } from "./components/PerfHud";

export default function Home() {
  return (
    <div className="flex h-screen w-screen">
      <ControlsPane />
      <PreviewPane />
      <PerfHud />
    </div>
  );
}
