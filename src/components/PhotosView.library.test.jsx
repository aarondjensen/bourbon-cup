/** @vitest-environment jsdom */
// The link out to the tournament's own photo site, and the 404 it used to be.
//
// PHOTO_LIBRARY_URL named `https://thebourboncup.com/photos`, which the site
// does not serve — the app is one page addressed by hash, and vercel.json
// rewrites only /finalcountdown. So the row at the bottom of the tab was a
// dead end every player could tap, and did.
//
// A mount test rather than a screenshot: what matters is whether the anchor
// EXISTS, which is a question about a constant nobody re-reads.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PhotosView } from "./PhotosView";
import { PHOTO_LIBRARY_URL } from "../constants";

afterEach(cleanup);

const mount = (props = {}) => render(
  <PhotosView
    items={[]}
    year={2025}
    uid="uid_aaron"
    isDirector={false}
    canPost
    onUpload={vi.fn()}
    onDelete={vi.fn()}
    onReport={vi.fn()}
    notify={vi.fn()}
    {...props}
  />
);

const libraryLink = () => screen.queryByText(/full photo library/i);

describe("the link to the full photo library", () => {
  it("is not drawn while there is nowhere to send anybody", () => {
    // The guard, exercised against whatever the constant currently holds.
    mount();
    if (PHOTO_LIBRARY_URL) expect(libraryLink()).toBeTruthy();
    else expect(libraryLink()).toBeNull();
  });

  it("is blank today, because the page it named 404s", () => {
    // The regression itself. If somebody sets this again, it has to be a URL
    // that is actually served — see the note in constants.js.
    expect(PHOTO_LIBRARY_URL).toBe("");
  });

  it("never points at a path this site does not route", () => {
    // /photos is not a route: tabs are hash-addressed (lib/deepLink) and
    // vercel.json rewrites only /finalcountdown. Naming it again is the exact
    // bug, so it is refused by name rather than by the general guard above.
    expect(PHOTO_LIBRARY_URL).not.toMatch(/thebourboncup\.com\/photos\/?$/);
  });
});

// The other half of the guard. Without this, emptying the constant and
// DELETING the row would pass every test above — and the day somebody sets a
// real URL, nothing would appear and nothing would say why.
describe("...and when a real one is set", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../constants"));

  it("is drawn, and points where the constant says", async () => {
    vi.doMock("../constants", async (importOriginal) => ({
      ...(await importOriginal()),
      PHOTO_LIBRARY_URL: "https://photos.example.test/bourbon",
    }));
    const { PhotosView: Fresh } = await import("./PhotosView");
    render(
      <Fresh
        items={[]} year={2025} uid="uid_aaron" isDirector={false} canPost
        onUpload={vi.fn()} onDelete={vi.fn()} onReport={vi.fn()} notify={vi.fn()}
      />
    );
    const link = libraryLink();
    expect(link).toBeTruthy();
    expect(link.closest("a").getAttribute("href")).toBe("https://photos.example.test/bourbon");
  });
});
