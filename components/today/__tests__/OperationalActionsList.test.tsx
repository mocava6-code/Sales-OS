// @vitest-environment jsdom
//
// Spanish-language product pass — regression guard. Today is the single
// most-visible screen in Sales OS; this proves the raw internal
// actionState/reasonCode enum values from
// server/services/conversation-action-state-service.ts never render to an
// advisor, and that every group shows the canonical mission-spec Spanish
// section title.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TodayActionGroupEntry, TodayActionGroups } from "@/server/services/conversation-action-state-service";
import { ACTION_REASON_CODE_LABELS, type ActionReasonCode } from "@/server/intelligence/response-action/reason-codes";
import { OperationalActionsList } from "../OperationalActionsList";

const RAW_ACTION_STATE_VALUES = ["REPLY_REQUIRED", "FOLLOW_UP_REQUIRED", "WAITING_ON_CUSTOMER", "NO_ACTION_REQUIRED", "UNCERTAIN"];

function entry(overrides: Partial<TodayActionGroupEntry> = {}): TodayActionGroupEntry {
  return {
    leadId: "lead-1",
    leadName: "Juan Pérez",
    leadPhone: "+51933517901",
    conversationId: "conv-1",
    actionState: "REPLY_REQUIRED",
    reasonCode: "PRICE_REQUEST",
    recommendedAction: null,
    lastActivityAt: new Date("2026-08-01T10:00:00.000Z"),
    vehicleBrand: null,
    vehicleModel: null,
    productInterest: null,
    assignedAdvisorName: "María López",
    ...overrides,
  };
}

function groups(overrides: Partial<TodayActionGroups> = {}): TodayActionGroups {
  return {
    replyRequired: [],
    followUpRequired: [],
    waitingOnCustomer: [],
    noActionRequired: [],
    uncertain: [],
    ...overrides,
  };
}

describe("OperationalActionsList — Spanish-language regression guard", () => {
  it("never renders a raw actionState enum value anywhere on the page", () => {
    render(
      <OperationalActionsList
        groups={groups({
          replyRequired: [entry({ reasonCode: "PRICE_REQUEST" })],
          followUpRequired: [entry({ actionState: "FOLLOW_UP_REQUIRED", reasonCode: "FOLLOW_UP_DUE" })],
          waitingOnCustomer: [entry({ actionState: "WAITING_ON_CUSTOMER", reasonCode: "WAITING_FOR_CUSTOMER_DECISION" })],
          uncertain: [entry({ actionState: "UNCERTAIN", reasonCode: "AMBIGUOUS_INTENT" })],
        })}
        now={new Date("2026-08-01T11:00:00.000Z")}
      />,
    );

    for (const rawValue of RAW_ACTION_STATE_VALUES) {
      expect(screen.queryByText(rawValue)).not.toBeInTheDocument();
    }
  });

  it("renders every ActionReasonCode's canonical Spanish label, never the raw code", () => {
    const codes = Object.keys(ACTION_REASON_CODE_LABELS) as ActionReasonCode[];

    for (const code of codes) {
      const { unmount } = render(
        <OperationalActionsList groups={groups({ replyRequired: [entry({ reasonCode: code })] })} now={new Date("2026-08-01T11:00:00.000Z")} />,
      );

      expect(screen.getByText(ACTION_REASON_CODE_LABELS[code])).toBeInTheDocument();
      expect(screen.queryByText(code)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the mission-spec canonical Spanish section titles", () => {
    render(<OperationalActionsList groups={groups()} now={new Date("2026-08-01T11:00:00.000Z")} />);

    expect(screen.getByText("Responder ahora")).toBeInTheDocument();
    expect(screen.getByText("Seguimiento")).toBeInTheDocument();
    expect(screen.getByText("Revisar")).toBeInTheDocument();
    expect(screen.getByText("Esperando al cliente")).toBeInTheDocument();
  });

  it("shows Spanish empty-state copy for every section, not English", () => {
    render(<OperationalActionsList groups={groups()} now={new Date("2026-08-01T11:00:00.000Z")} />);

    expect(screen.getByText("Nada necesita respuesta por ahora.")).toBeInTheDocument();
    expect(screen.getByText("No hay seguimientos pendientes.")).toBeInTheDocument();
    expect(screen.getByText("Nada necesita revisión.")).toBeInTheDocument();
    expect(screen.getByText("No hay conversaciones esperando al cliente.")).toBeInTheDocument();
  });

  it("shows the Spanish 'Asignado a' prefix, not the English 'Assigned to'", () => {
    render(
      <OperationalActionsList
        groups={groups({ replyRequired: [entry({ assignedAdvisorName: "María López" })] })}
        now={new Date("2026-08-01T11:00:00.000Z")}
      />,
    );

    expect(screen.getByText("Asignado a María López")).toBeInTheDocument();
    expect(screen.queryByText(/Assigned to/)).not.toBeInTheDocument();
  });
});
