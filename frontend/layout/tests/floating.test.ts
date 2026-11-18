// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    collectSnapLines,
    findFreeRect,
    findLinkedBoxes,
    followResize,
    isFullRect,
    keepReachable,
    largestFreeRect,
    placeNewFloat,
    resizeBox,
    resizeLimits,
    snapMove,
    splitRect,
    toFractions,
    toPixels,
    zoneAtPoint,
    zoneRect,
} from "../lib/floating";

const container: Dimensions = { left: 0, top: 0, width: 2000, height: 1000 };
const leftHalf: Dimensions = { left: 0, top: 0, width: 1000, height: 1000 };
const rightHalf: Dimensions = { left: 1000, top: 0, width: 1000, height: 1000 };

test("fractions and pixels convert both ways", () => {
    const fractions = toFractions({ left: 500, top: 250, width: 1000, height: 500 }, container);
    assert.deepEqual(fractions, { left: 0.25, top: 0.25, width: 0.5, height: 0.5 });
    assert.deepEqual(toPixels(fractions, container), { left: 500, top: 250, width: 1000, height: 500 });
    assert.isTrue(isFullRect(undefined));
    assert.isTrue(isFullRect({ left: 0, top: 0, width: 1, height: 1 }));
    assert.isFalse(isFullRect({ left: 0, top: 0, width: 0.5, height: 1 }));
});

test("largestFreeRect finds the space the obstacles leave", () => {
    assert.deepEqual(largestFreeRect(container, []), container);
    assert.deepEqual(largestFreeRect(container, [leftHalf]), rightHalf);
    assert.isUndefined(largestFreeRect(container, [container]));
    // an obstacle in the middle leaves two equal sides: the right one wins
    const middle: Dimensions = { left: 800, top: 0, width: 400, height: 1000 };
    assert.deepEqual(largestFreeRect(container, [middle]), { left: 1200, top: 0, width: 800, height: 1000 });
    // an L-shaped rest: the larger of its two rectangles
    const corner: Dimensions = { left: 0, top: 0, width: 1500, height: 700 };
    assert.deepEqual(largestFreeRect(container, [corner]), { left: 0, top: 700, width: 2000, height: 300 });
});

test("findFreeRect ignores space that is too small to be useful", () => {
    assert.deepEqual(findFreeRect(container, [leftHalf]), rightHalf);
    const almostAll: Dimensions = { left: 0, top: 0, width: 1900, height: 1000 };
    assert.isUndefined(findFreeRect(container, [almostAll]));
    // the largest rest is a strip too flat to use, but the smaller one beside the obstacle will do
    const corner: Dimensions = { left: 0, top: 0, width: 1500, height: 800 };
    assert.deepEqual(findFreeRect(container, [corner]), { left: 1500, top: 0, width: 500, height: 1000 });
});

test("a new floating block fills the empty space beside the tiles", () => {
    assert.deepEqual(placeNewFloat(container, [leftHalf], []), rightHalf);
});

test("a new floating block reopens where the last one was only when there is no empty space", () => {
    const last: Dimensions = { left: 1200, top: 100, width: 700, height: 800 };
    assert.deepEqual(placeNewFloat(container, [leftHalf], [], last), rightHalf);
    assert.deepEqual(placeNewFloat(container, [container], [], last), last);
    // when a floating block is in that very place, the new one is stepped off it
    const placed = placeNewFloat(container, [container, last], [last], last);
    assert.deepEqual(placed, { left: 1228, top: 128, width: 672, height: 772 });
    // empty space is preferred to covering a floating block
    const small: Dimensions = { left: 1000, top: 0, width: 1000, height: 400 };
    assert.deepEqual(placeNewFloat(container, [leftHalf, small], [small], small), {
        left: 1000,
        top: 400,
        width: 1000,
        height: 600,
    });
});

test("with no empty space, a new floating block is centred over the tiles", () => {
    const placed = placeNewFloat(container, [container], []);
    assert.deepEqual(placed, { left: 500, top: 100, width: 1000, height: 800 });
});

test("a second floating block is stacked on the first, stepped off it", () => {
    const first = placeNewFloat(container, [leftHalf], []);
    const second = placeNewFloat(container, [leftHalf, first], [first], undefined, first);
    assert.deepEqual(second, { left: 1028, top: 28, width: 972, height: 972 });
    const third = placeNewFloat(container, [leftHalf, first, second], [first, second], undefined, second);
    assert.deepEqual(third, { left: 1056, top: 56, width: 944, height: 944 });
    // where the last one was closed matters less than where the others are now
    const stale: Dimensions = { left: 700, top: 0, width: 1300, height: 1000 };
    assert.deepEqual(placeNewFloat(container, [leftHalf, first], [first], stale, first), second);
    // a small floating block is not a place to stack on
    const small: Dimensions = { left: 1500, top: 600, width: 400, height: 300 };
    assert.deepEqual(placeNewFloat(container, [container, small], [small], undefined, small), {
        left: 500,
        top: 100,
        width: 1000,
        height: 800,
    });
});

test("keepReachable leaves the header inside the container", () => {
    const offRight = keepReachable({ left: 1990, top: 990, width: 400, height: 300 }, container);
    assert.equal(offRight.left, 1920);
    assert.equal(offRight.top, 968);
    const offLeft = keepReachable({ left: -500, top: -50, width: 400, height: 300 }, container);
    assert.equal(offLeft.left, -320);
    assert.equal(offLeft.top, 0);
});

test("a moved box snaps to the nearest line with either edge", () => {
    const lines = collectSnapLines(container, [leftHalf]);
    // its left edge is 8px from the tiles' right edge
    assert.deepEqual(snapMove({ left: 1008, top: 300, width: 400, height: 300 }, lines), {
        left: 1000,
        top: 300,
        width: 400,
        height: 300,
    });
    // its right edge is 5px from the container's right edge
    assert.equal(snapMove({ left: 1595, top: 300, width: 400, height: 300 }, lines).left, 1600);
    // nothing near: it stays where it is
    assert.equal(snapMove({ left: 1250, top: 300, width: 400, height: 300 }, lines).left, 1250);
    // the top edge snaps on its own axis
    assert.equal(snapMove({ left: 1250, top: 6, width: 400, height: 300 }, lines).top, 0);
});

test("dragging an edge takes the box on the other side of it along", () => {
    const tiles = { id: "tiles", rect: leftHalf };
    const float = { id: "f1", rect: rightHalf };
    const elsewhere = { id: "f2", rect: { left: 1500, top: 0, width: 300, height: 300 } };
    const linked = findLinkedBoxes(tiles, { right: true }, [float, elsewhere]);
    assert.deepEqual(
        linked.map((l) => [l.id, l.edges]),
        [["f1", { left: true }]]
    );
    const limits = resizeLimits(container, linked);
    assert.equal(limits.maxRight, 1800);
    const lines = collectSnapLines(container, []);
    const resized = resizeBox(tiles.rect, { right: true }, 200, 0, lines, limits);
    assert.deepEqual(resized, { left: 0, top: 0, width: 1200, height: 1000 });
    assert.deepEqual(followResize(linked[0], resized), { left: 1200, top: 0, width: 800, height: 1000 });
    // the follower is not squeezed below the minimum size
    const squeezed = resizeBox(tiles.rect, { right: true }, 950, 0, lines, limits);
    assert.equal(squeezed.width, 1800);
});

test("a resized edge snaps to the thirds of the container and stops at the minimum size", () => {
    const lines = collectSnapLines(container, []);
    const limits = resizeLimits(container, []);
    const toThird = resizeBox(leftHalf, { right: true }, -325, 0, lines, limits);
    assert.closeTo(toThird.width, 2000 / 3, 0.001);
    const tooSmall = resizeBox(leftHalf, { right: true }, -950, 0, lines, limits);
    assert.equal(tooSmall.width, 200);
    const corner = resizeBox(rightHalf, { left: true, bottom: true }, 100, -400, lines, limits);
    assert.deepEqual(corner, { left: 1100, top: 0, width: 900, height: 600 });
});

test("zones are entered by pushing the pointer against an edge", () => {
    assert.equal(zoneAtPoint({ x: 2, y: 500 }, container), "left");
    assert.equal(zoneAtPoint({ x: 1999, y: 500 }, container), "right");
    assert.equal(zoneAtPoint({ x: 900, y: 0 }, container), "top");
    assert.equal(zoneAtPoint({ x: 1998, y: 1 }, container), "topright");
    assert.equal(zoneAtPoint({ x: 3, y: 998 }, container), "bottomleft");
    // lining a block up with the top edge leaves the pointer in its header, which is not the zone
    assert.isUndefined(zoneAtPoint({ x: 900, y: 15 }, container));
    assert.isUndefined(zoneAtPoint({ x: 900, y: 500 }, container));
});

test("a side zone is the empty space on that side, or else that half", () => {
    const narrowTiles: Dimensions = { left: 0, top: 0, width: 800, height: 1000 };
    assert.deepEqual(zoneRect("right", container, [narrowTiles]), {
        left: 800,
        top: 0,
        width: 1200,
        height: 1000,
    });
    assert.deepEqual(zoneRect("right", container, [container]), rightHalf);
    assert.deepEqual(zoneRect("left", container, []), leftHalf);
    assert.deepEqual(zoneRect("top", container, [narrowTiles]), container);
    assert.deepEqual(zoneRect("bottomright", container, []), { left: 1000, top: 500, width: 1000, height: 500 });
});

test("splitRect halves a rectangle on the requested side", () => {
    const after = splitRect(rightHalf, "column", "after");
    assert.deepEqual(after.kept, { left: 1000, top: 0, width: 1000, height: 500 });
    assert.deepEqual(after.added, { left: 1000, top: 500, width: 1000, height: 500 });
    const before = splitRect(rightHalf, "row", "before");
    assert.deepEqual(before.added, { left: 1000, top: 0, width: 500, height: 1000 });
    assert.deepEqual(before.kept, { left: 1500, top: 0, width: 500, height: 1000 });
});
