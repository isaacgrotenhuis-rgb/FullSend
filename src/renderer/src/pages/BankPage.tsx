import { useState, type ReactElement } from "react";
import type { WorkoutInterval } from "@shared/ipc/contracts";
import { WorkoutBankBrowser } from "./WorkoutBankBrowser";

type Props = {
  ftp: number;
  connectedTrainerDeviceId: string | null;
  busy: boolean;
  error: string | null;
  onStartAdhoc: (bankWorkoutId: string, name: string, intervals: WorkoutInterval[]) => void;
};

export const BankPage = ({
  ftp,
  connectedTrainerDeviceId,
  busy,
  error,
  onStartAdhoc
}: Props): ReactElement => {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div>
        <h2 style={{ margin: 0 }}>Workout Bank</h2>
        <p className="card-meta" style={{ margin: "var(--space-1) 0 0" }}>
          Curated structured workouts. Preview one at your current FTP ({ftp} W) and start it ad-hoc.
        </p>
      </div>

      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Browse the bank
      </button>

      {open ? (
        <WorkoutBankBrowser
          ftp={ftp}
          connectedTrainerDeviceId={connectedTrainerDeviceId}
          busy={busy}
          error={error}
          onStartAdhoc={onStartAdhoc}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
};
