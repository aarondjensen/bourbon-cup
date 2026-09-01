/** @vitest-environment jsdom */
// The report button: who is offered it, and what it says once used.
//
// A mount test rather than a screenshot, because what matters here is not how
// it looks but WHO SEES IT. Offering a guest a button the security rules will
// refuse is the failure this guards, and no screenshot catches that.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PhotosView } from "./PhotosView";
import { REPORTED_KEY } from "../lib/mediaReports";

afterEach(cleanup);
beforeEach(() => { try { localStorage.removeItem(REPORTED_KEY); } catch { /* jsdom always has it */ } });

const photo = (over = {}) => ({
  id: "med_bc_2025_a1",
  tournament_id: "bc_2025",
  url: "https://example.test/a1.webp",
  thumbUrl: "https://example.test/a1-thumb.webp",
  host: "storage",
  uploadedBy: "uid_ben",
  uploadedByName: "Ben T",
  takenAt: 1_700_000_000_000,
  ...over,
});

// The lightbox fetches the photo's bytes so "Save to phone" can hand over a
// blob. jsdom has no fetch worth the name and the component already treats a
// failure as "save falls back to a tab", so a rejection is the honest stub.
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network")))); });
afterEach(() => vi.unstubAllGlobals());

const open = () => fireEvent.click(screen.getAllByRole("button").find(b => b.querySelector("img")) || screen.getAllByRole("button")[0]);

const mount = (props = {}) => render(
  <PhotosView
    items={[photo()]}
    year={2025}
    uid="uid_aaron"
    isDirector={false}
    canPost
    onUpload={vi.fn()}
    onDelete={vi.fn()}
    onReport={vi.fn(() => Promise.resolve())}
    notify={vi.fn()}
    {...props}
  />
);

describe("the report button", () => {
  it("is offered on somebody else's photo", () => {
    mount();
    open();
    expect(screen.getByText("Report this photo")).toBeTruthy();
  });

  it("is not offered to a guest", () => {
    // A guest holds no uid, so the rules refuse the write before the UI is
    // consulted — the button would be one that cannot work.
    mount({ uid: null });
    open();
    expect(screen.queryByText("Report this photo")).toBeNull();
  });

  it("is not offered on your own photo", () => {
    // You can already delete that one; Report is a worse version of a button
    // that is already there.
    mount({ uid: "uid_ben" });
    open();
    expect(screen.queryByText("Report this photo")).toBeNull();
  });

  it("says so afterwards rather than offering again", async () => {
    const onReport = vi.fn(() => Promise.resolve());
    mount({ onReport });
    open();
    fireEvent.click(screen.getByText("Report this photo"));
    fireEvent.click(await screen.findByText("Report"));   // the confirm dialog
    expect(await screen.findByText(/Reported — a director has been told/)).toBeTruthy();
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("shows a director how many people raised it", () => {
    // Beside the uploader's name in the lightbox, never on a grid tile: a flag
    // on a thumbnail is a public accusation in a gallery sixteen people scroll.
    mount({ isDirector: true, reportCounts: new Map([["med_bc_2025_a1", 2]]) });
    open();
    expect(screen.getByText(/⚑ reported ×2/)).toBeTruthy();
  });

  it("shows nothing to a director when nothing is reported", () => {
    mount({ isDirector: true, reportCounts: new Map() });
    open();
    expect(screen.queryByText(/⚑ reported/)).toBeNull();
  });
});
