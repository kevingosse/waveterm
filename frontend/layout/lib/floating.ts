// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Geometry for the boxes of a layout that can be moved and resized freely: the floating blocks, and the area that the
// tiles fill. Where a new floating block goes, what a box snaps to, which boxes follow an edge that is dragged.
//
// Everything here is pure. Rectangles are in CSS pixels relative to the layout container, except where a function
// says that it takes or returns fractions of the container, which is how they are stored.

export const TilesBoxId = "tiles";

export const MinBoxWidthPx = 200;
export const MinBoxHeightPx = 100;
export const SnapDistancePx = 12;

const CascadeOffsetPx = 28;
const MaxCascadeSteps = 6;
// how much of a floating block has to stay inside the container, so that its header can still be grabbed
const ReachableWidthPx = 80;
const ReachableHeightPx = 32;
// two edges this close together count as the same edge
const SameEdgePx = 1.5;
const SideZonePx = 6;
const TopZonePx = 3;

export type BoxEdges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

export interface Box {
    id: string;
    rect: Dimensions;
}

export interface LinkedBox {
    id: string;
    edges: BoxEdges;
    startRect: Dimensions;
}

export interface SnapLines {
    xs: number[];
    ys: number[];
}

export interface ResizeLimits {
    minLeft: number;
    maxRight: number;
    minTop: number;
    maxBottom: number;
}

export type SnapZone = "left" | "right" | "top" | "topleft" | "topright" | "bottomleft" | "bottomright";

function rightOf(rect: Dimensions): number {
    return rect.left + rect.width;
}

function bottomOf(rect: Dimensions): number {
    return rect.top + rect.height;
}

function roundFraction(value: number): number {
    return Math.round(value * 1e5) / 1e5;
}

export function toPixels(fractions: Dimensions, container: Dimensions): Dimensions {
    return {
        left: container.left + fractions.left * container.width,
        top: container.top + fractions.top * container.height,
        width: fractions.width * container.width,
        height: fractions.height * container.height,
    };
}

export function toFractions(rect: Dimensions, container: Dimensions): Dimensions {
    if (container.width <= 0 || container.height <= 0) {
        return { left: 0, top: 0, width: 1, height: 1 };
    }
    return {
        left: roundFraction((rect.left - container.left) / container.width),
        top: roundFraction((rect.top - container.top) / container.height),
        width: roundFraction(rect.width / container.width),
        height: roundFraction(rect.height / container.height),
    };
}

/**
 * Whether a rectangle given in fractions covers the whole container.
 */
export function isFullRect(fractions: Dimensions): boolean {
    if (fractions == null) {
        return true;
    }
    const eps = 1e-3;
    return (
        fractions.left <= eps &&
        fractions.top <= eps &&
        fractions.left + fractions.width >= 1 - eps &&
        fractions.top + fractions.height >= 1 - eps
    );
}

export function rectsOverlap(a: Dimensions, b: Dimensions, tolerance = 0.5): boolean {
    return (
        a.left < rightOf(b) - tolerance &&
        rightOf(a) > b.left + tolerance &&
        a.top < bottomOf(b) - tolerance &&
        bottomOf(a) > b.top + tolerance
    );
}

function uniqueSorted(values: number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.filter((value, idx) => idx == 0 || value - sorted[idx - 1] > 0.5);
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * The largest rectangle inside the container that touches none of the obstacles, among those that `accept` allows.
 * Of two that are equally large, the one further right wins: that is where things are opened next to a terminal.
 */
export function largestFreeRect(
    container: Dimensions,
    obstacles: Dimensions[],
    accept?: (rect: Dimensions) => boolean
): Dimensions {
    const containerRight = rightOf(container);
    const containerBottom = bottomOf(container);
    const xs = uniqueSorted([
        container.left,
        containerRight,
        ...obstacles.flatMap((o) => [
            clampNumber(o.left, container.left, containerRight),
            clampNumber(rightOf(o), container.left, containerRight),
        ]),
    ]);
    const ys = uniqueSorted([
        container.top,
        containerBottom,
        ...obstacles.flatMap((o) => [
            clampNumber(o.top, container.top, containerBottom),
            clampNumber(bottomOf(o), container.top, containerBottom),
        ]),
    ]);
    let best: Dimensions;
    let bestArea = 0;
    for (let x1 = 0; x1 < xs.length - 1; x1++) {
        for (let x2 = x1 + 1; x2 < xs.length; x2++) {
            for (let y1 = 0; y1 < ys.length - 1; y1++) {
                for (let y2 = y1 + 1; y2 < ys.length; y2++) {
                    const rect: Dimensions = {
                        left: xs[x1],
                        top: ys[y1],
                        width: xs[x2] - xs[x1],
                        height: ys[y2] - ys[y1],
                    };
                    const area = rect.width * rect.height;
                    if (area < bestArea || (area == bestArea && best != null && rect.left <= best.left)) {
                        continue;
                    }
                    if (obstacles.some((o) => rectsOverlap(o, rect))) {
                        continue;
                    }
                    if (accept != null && !accept(rect)) {
                        continue;
                    }
                    best = rect;
                    bestArea = area;
                }
            }
        }
    }
    return best;
}

/**
 * Empty space that is worth opening a block in, if there is any.
 */
export function findFreeRect(container: Dimensions, obstacles: Dimensions[]): Dimensions {
    const minWidth = Math.max(360, container.width * 0.2);
    const minHeight = Math.max(240, container.height * 0.3);
    return largestFreeRect(container, obstacles, (rect) => rect.width >= minWidth && rect.height >= minHeight);
}

function defaultFloatRect(container: Dimensions): Dimensions {
    const width = Math.min(container.width, Math.max(480, container.width * 0.5));
    const height = Math.min(container.height, Math.max(320, container.height * 0.8));
    return {
        left: container.left + (container.width - width) / 2,
        top: container.top + (container.height - height) / 2,
        width,
        height,
    };
}

function sameCorner(a: Dimensions, b: Dimensions): boolean {
    return Math.abs(a.left - b.left) < 4 && Math.abs(a.top - b.top) < 4;
}

// one step down and to the right, inside the rectangle it starts from, so that what is underneath keeps its header
// and its left edge in view
function cascadeFrom(rect: Dimensions): Dimensions {
    if (rect.width - CascadeOffsetPx < MinBoxWidthPx || rect.height - CascadeOffsetPx < MinBoxHeightPx) {
        return rect;
    }
    return {
        left: rect.left + CascadeOffsetPx,
        top: rect.top + CascadeOffsetPx,
        width: rect.width - CascadeOffsetPx,
        height: rect.height - CascadeOffsetPx,
    };
}

// a floating block has to be this large for the next one to be stacked on it rather than put somewhere of its own
function isWorthStackingOn(rect: Dimensions, container: Dimensions): boolean {
    return rect.width >= container.width * 0.3 && rect.height >= container.height * 0.4;
}

/**
 * Where a new floating block opens: in the largest empty space, if one is worth using; otherwise on top of what is
 * there. That is on the floating block it is asked to stack on, or else where the last one was, or else in the
 * middle. It is stepped off a floating block it would hide.
 *
 * Where the last one was does not count while there is empty space: it may have been a block of another kind, in a
 * corner, and a document would open in that corner with half the tab free.
 *
 * @param obstacles Everything that occupies space: the floating blocks and, if there are tiles, the area they fill.
 * @param floats The floating blocks.
 * @param lastRect Where the last floating block was when it was closed.
 * @param stackOn The floating block to open on top of when there is no empty space: the topmost one that is not the
 * block the user is working in.
 */
export function placeNewFloat(
    container: Dimensions,
    obstacles: Dimensions[],
    floats: Dimensions[],
    lastRect?: Dimensions,
    stackOn?: Dimensions
): Dimensions {
    const free = findFreeRect(container, obstacles);
    if (free != null) {
        return free;
    }
    if (stackOn != null && !isWorthStackingOn(stackOn, container)) {
        stackOn = undefined;
    }
    let rect = stackOn ?? lastRect ?? defaultFloatRect(container);
    for (let step = 0; step < MaxCascadeSteps && floats.some((f) => sameCorner(f, rect)); step++) {
        const next = cascadeFrom(rect);
        if (next === rect) {
            break;
        }
        rect = next;
    }
    return keepReachable(rect, container);
}

/**
 * Moves a rectangle back far enough into the container that its header can be reached.
 */
export function keepReachable(rect: Dimensions, container: Dimensions): Dimensions {
    const width = Math.min(rect.width, container.width);
    const height = Math.min(rect.height, container.height);
    return {
        width,
        height,
        left: clampNumber(rect.left, container.left - width + ReachableWidthPx, rightOf(container) - ReachableWidthPx),
        top: clampNumber(rect.top, container.top, bottomOf(container) - ReachableHeightPx),
    };
}

/**
 * The lines a box snaps to: the container's edges, its halves and thirds, and the edges of the other boxes.
 */
export function collectSnapLines(container: Dimensions, others: Dimensions[]): SnapLines {
    const fractions = [0, 1 / 3, 1 / 2, 2 / 3, 1];
    return {
        xs: uniqueSorted([
            ...fractions.map((f) => container.left + f * container.width),
            ...others.flatMap((o) => [o.left, rightOf(o)]),
        ]),
        ys: uniqueSorted([
            ...fractions.map((f) => container.top + f * container.height),
            ...others.flatMap((o) => [o.top, bottomOf(o)]),
        ]),
    };
}

// how far `value` is from the nearest line, if one is close enough to snap to
function snapDelta(value: number, lines: number[], distance: number): number {
    let best: number;
    for (const line of lines) {
        const delta = line - value;
        if (Math.abs(delta) <= distance && (best == null || Math.abs(delta) < Math.abs(best))) {
            best = delta;
        }
    }
    return best;
}

function smallerDelta(a: number, b: number): number {
    if (a == null) {
        return b ?? 0;
    }
    if (b == null) {
        return a;
    }
    return Math.abs(a) <= Math.abs(b) ? a : b;
}

/**
 * Snaps a box that is being moved: whichever of its edges is nearest to a line is put on that line.
 */
export function snapMove(rect: Dimensions, lines: SnapLines, distance = SnapDistancePx): Dimensions {
    const dx = smallerDelta(snapDelta(rect.left, lines.xs, distance), snapDelta(rightOf(rect), lines.xs, distance));
    const dy = smallerDelta(snapDelta(rect.top, lines.ys, distance), snapDelta(bottomOf(rect), lines.ys, distance));
    return { ...rect, left: rect.left + dx, top: rect.top + dy };
}

/**
 * The boxes whose facing edge lies on an edge that is about to be dragged. They are resized with it, so that boxes
 * which were put side by side stay side by side.
 */
export function findLinkedBoxes(box: Box, edges: BoxEdges, others: Box[]): LinkedBox[] {
    const rect = box.rect;
    const linked: LinkedBox[] = [];
    for (const other of others) {
        const o = other.rect;
        const sharesRows = o.top < bottomOf(rect) - SameEdgePx && bottomOf(o) > rect.top + SameEdgePx;
        const sharesColumns = o.left < rightOf(rect) - SameEdgePx && rightOf(o) > rect.left + SameEdgePx;
        const otherEdges: BoxEdges = {};
        if (edges.right && sharesRows && Math.abs(o.left - rightOf(rect)) <= SameEdgePx) {
            otherEdges.left = true;
        }
        if (edges.left && sharesRows && Math.abs(rightOf(o) - rect.left) <= SameEdgePx) {
            otherEdges.right = true;
        }
        if (edges.bottom && sharesColumns && Math.abs(o.top - bottomOf(rect)) <= SameEdgePx) {
            otherEdges.top = true;
        }
        if (edges.top && sharesColumns && Math.abs(bottomOf(o) - rect.top) <= SameEdgePx) {
            otherEdges.bottom = true;
        }
        if (Object.keys(otherEdges).length > 0) {
            linked.push({ id: other.id, edges: otherEdges, startRect: o });
        }
    }
    return linked;
}

/**
 * How far the edges of a box may be dragged: not out of the container, and not so far that a box which follows them
 * becomes smaller than a box may be.
 */
export function resizeLimits(container: Dimensions, linked: LinkedBox[]): ResizeLimits {
    const limits: ResizeLimits = {
        minLeft: container.left,
        maxRight: rightOf(container),
        minTop: container.top,
        maxBottom: bottomOf(container),
    };
    for (const link of linked) {
        const rect = link.startRect;
        if (link.edges.left) {
            limits.maxRight = Math.min(limits.maxRight, rightOf(rect) - MinBoxWidthPx);
        }
        if (link.edges.right) {
            limits.minLeft = Math.max(limits.minLeft, rect.left + MinBoxWidthPx);
        }
        if (link.edges.top) {
            limits.maxBottom = Math.min(limits.maxBottom, bottomOf(rect) - MinBoxHeightPx);
        }
        if (link.edges.bottom) {
            limits.minTop = Math.max(limits.minTop, rect.top + MinBoxHeightPx);
        }
    }
    return limits;
}

/**
 * The rectangle of a box after the given edges have been dragged by (dx, dy) from where they started.
 */
export function resizeBox(
    start: Dimensions,
    edges: BoxEdges,
    dx: number,
    dy: number,
    lines: SnapLines,
    limits: ResizeLimits,
    distance = SnapDistancePx
): Dimensions {
    let left = start.left;
    let right = rightOf(start);
    let top = start.top;
    let bottom = bottomOf(start);
    if (edges.left) {
        left += dx;
        left += snapDelta(left, lines.xs, distance) ?? 0;
        left = clampNumber(left, limits.minLeft, Math.max(limits.minLeft, right - MinBoxWidthPx));
    }
    if (edges.right) {
        right += dx;
        right += snapDelta(right, lines.xs, distance) ?? 0;
        right = clampNumber(right, Math.min(limits.maxRight, left + MinBoxWidthPx), limits.maxRight);
    }
    if (edges.top) {
        top += dy;
        top += snapDelta(top, lines.ys, distance) ?? 0;
        top = clampNumber(top, limits.minTop, Math.max(limits.minTop, bottom - MinBoxHeightPx));
    }
    if (edges.bottom) {
        bottom += dy;
        bottom += snapDelta(bottom, lines.ys, distance) ?? 0;
        bottom = clampNumber(bottom, Math.min(limits.maxBottom, top + MinBoxHeightPx), limits.maxBottom);
    }
    return { left, top, width: right - left, height: bottom - top };
}

/**
 * The rectangle of a linked box once the box it follows has been resized to `leader`.
 */
export function followResize(link: LinkedBox, leader: Dimensions): Dimensions {
    let left = link.startRect.left;
    let right = rightOf(link.startRect);
    let top = link.startRect.top;
    let bottom = bottomOf(link.startRect);
    if (link.edges.left) {
        left = rightOf(leader);
    }
    if (link.edges.right) {
        right = leader.left;
    }
    if (link.edges.top) {
        top = bottomOf(leader);
    }
    if (link.edges.bottom) {
        bottom = leader.top;
    }
    return { left, top, width: right - left, height: bottom - top };
}

/**
 * The zone a floating block is being dragged into, if the pointer has been pushed against an edge of the container.
 * The top edge only counts once the pointer is on it, so that lining a block up with the top does not trigger it.
 */
export function zoneAtPoint(point: Point, container: Dimensions): SnapZone {
    const atLeft = point.x <= container.left + SideZonePx;
    const atRight = point.x >= rightOf(container) - SideZonePx;
    const atTop = point.y <= container.top + TopZonePx;
    const atBottom = point.y >= bottomOf(container) - SideZonePx;
    if (atLeft) {
        return atTop ? "topleft" : atBottom ? "bottomleft" : "left";
    }
    if (atRight) {
        return atTop ? "topright" : atBottom ? "bottomright" : "right";
    }
    if (atTop) {
        return "top";
    }
    return undefined;
}

/**
 * What a zone stands for. A side is the empty space along that side when there is some, so that a block dropped
 * there fills what the other boxes left over; otherwise it is that half of the container.
 */
export function zoneRect(zone: SnapZone, container: Dimensions, obstacles: Dimensions[]): Dimensions {
    const halfWidth = container.width / 2;
    const halfHeight = container.height / 2;
    const midX = container.left + halfWidth;
    const midY = container.top + halfHeight;
    switch (zone) {
        case "top":
            return { ...container };
        case "topleft":
            return { left: container.left, top: container.top, width: halfWidth, height: halfHeight };
        case "topright":
            return { left: midX, top: container.top, width: halfWidth, height: halfHeight };
        case "bottomleft":
            return { left: container.left, top: midY, width: halfWidth, height: halfHeight };
        case "bottomright":
            return { left: midX, top: midY, width: halfWidth, height: halfHeight };
    }
    const minWidth = Math.max(MinBoxWidthPx, container.width * 0.15);
    const minHeight = Math.max(MinBoxHeightPx, container.height * 0.3);
    const free = largestFreeRect(container, obstacles, (rect) => {
        if (rect.width < minWidth || rect.height < minHeight) {
            return false;
        }
        if (zone == "left") {
            return rect.left <= container.left + SameEdgePx;
        }
        return rightOf(rect) >= rightOf(container) - SameEdgePx;
    });
    if (free != null && free.width < container.width - SameEdgePx) {
        return free;
    }
    return {
        left: zone == "left" ? container.left : midX,
        top: container.top,
        width: halfWidth,
        height: container.height,
    };
}

/**
 * Splits a rectangle in two, the way a tile is split: `kept` stays with the block that was there, `added` is for the
 * new one.
 */
export function splitRect(
    rect: Dimensions,
    direction: "row" | "column",
    position: "before" | "after"
): { kept: Dimensions; added: Dimensions } {
    const first: Dimensions =
        direction == "row" ? { ...rect, width: rect.width / 2 } : { ...rect, height: rect.height / 2 };
    const second: Dimensions =
        direction == "row"
            ? { ...first, left: rect.left + rect.width / 2 }
            : { ...first, top: rect.top + rect.height / 2 };
    return position == "before" ? { kept: second, added: first } : { kept: first, added: second };
}
