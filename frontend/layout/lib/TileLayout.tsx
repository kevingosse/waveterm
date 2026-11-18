// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { getSettingsKeyAtom } from "@/app/store/global";
import clsx from "clsx";
import { toPng } from "html-to-image";
import { Atom, useAtomValue, useSetAtom } from "jotai";
import React, {
    CSSProperties,
    ReactNode,
    Suspense,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { DropTargetMonitor, XYCoord, useDrag, useDragLayer, useDrop } from "react-dnd";
import { debounce, throttle } from "throttle-debounce";
import { useDevicePixelRatio } from "use-device-pixel-ratio";
import { BoxEdges, TilesBoxId } from "./floating";
import { LayoutModel } from "./layoutModel";
import { useNodeModel, useTileLayout } from "./layoutModelHooks";
import "./tilelayout.scss";
import {
    BoxFrameProps,
    LayoutNode,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    ResizeHandleProps,
    TileLayoutContents,
} from "./types";
import { determineDropDirection, setTransform } from "./utils";

const tileItemType = "TILE_ITEM";

export interface TileLayoutProps {
    /**
     * The atom containing the layout tree state.
     */
    tabAtom: Atom<Tab>;

    /**
     * callbacks and information about the contents (or styling) of the TileLayout or contents
     */
    contents: TileLayoutContents;

    /**
     * A callback for getting the cursor point in reference to the current window. This removes Electron as a runtime dependency, allowing for better integration with Storybook.
     * @returns The cursor position relative to the current window.
     */
    getCursorPoint?: () => Point;
}

const DragPreviewWidth = 300;
const DragPreviewHeight = 300;
// how far the pointer has to travel with the button down before a floating block starts to move
const BoxMoveThresholdPx = 4;
// The strip along an edge of a box that resizes it. It lies half on each side of the edge, except along the edge of
// the container, where there is no outside: there it is the border of the block.
const BoxHandleSizePx = 6;
const BoxEdgeHandleSizePx = 4;
const BoxCornerSizePx = 14;

/**
 * Pointer handlers that move or resize a box: a floating block, or the area the tiles fill.
 * @param canStart Decides from the pointerdown event whether a drag may begin with it.
 */
function useBoxDrag(
    layoutModel: LayoutModel,
    boxId: string,
    mode: "move" | "resize",
    edges: BoxEdges,
    canStart?: (event: React.PointerEvent<HTMLDivElement>) => boolean
) {
    const dragRef = useRef<{ pointerId: number; x: number; y: number; dragging: boolean }>(null);
    const threshold = mode === "move" ? BoxMoveThresholdPx : 0;

    function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || (canStart != null && !canStart(event))) {
            return;
        }
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
        if (threshold == 0) {
            event.preventDefault();
            startDrag(event);
        }
    }

    function startDrag(event: React.PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        drag.dragging = true;
        // so that the drag goes on when the pointer leaves the element, and nothing underneath reacts to it
        event.currentTarget.setPointerCapture(event.pointerId);
        layoutModel.startBoxDrag(boxId, mode, edges, drag.x, drag.y);
    }

    function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (drag == null || drag.pointerId !== event.pointerId) {
            return;
        }
        if ((event.buttons & 1) == 0) {
            finish(true);
            return;
        }
        if (!drag.dragging) {
            if (Math.abs(event.clientX - drag.x) < threshold && Math.abs(event.clientY - drag.y) < threshold) {
                return;
            }
            startDrag(event);
        }
        layoutModel.moveBoxDrag(event.clientX, event.clientY);
    }

    function finish(cancel: boolean) {
        const drag = dragRef.current;
        if (drag == null) {
            return;
        }
        dragRef.current = null;
        if (drag.dragging) {
            layoutModel.endBoxDrag(cancel);
        }
    }

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: () => finish(false),
        onPointerCancel: () => finish(true),
        onLostPointerCapture: () => finish(false),
    };
}

function TileLayoutComponent({ tabAtom, contents, getCursorPoint }: TileLayoutProps) {
    const layoutModel = useTileLayout(tabAtom, contents);
    const overlayTransform = useAtomValue(layoutModel.overlayTransform);
    const setActiveDrag = useSetAtom(layoutModel.activeDrag);
    const setReady = useSetAtom(layoutModel.ready);
    const isResizing = useAtomValue(layoutModel.isResizing);

    const { activeDrag, dragClientOffset, dragItemType } = useDragLayer((monitor) => ({
        activeDrag: monitor.isDragging(),
        dragClientOffset: monitor.getClientOffset(),
        dragItemType: monitor.getItemType(),
    }));

    useEffect(() => {
        const activeTileDrag = activeDrag && dragItemType == tileItemType;
        setActiveDrag(activeTileDrag);
    }, [activeDrag, dragItemType]);

    const checkForCursorBounds = useCallback(
        debounce(100, (dragClientOffset: XYCoord) => {
            const cursorPoint = dragClientOffset ?? getCursorPoint?.();
            if (cursorPoint && layoutModel.displayContainerRef?.current) {
                const displayContainerRect = layoutModel.displayContainerRef.current.getBoundingClientRect();
                const normalizedX = cursorPoint.x - displayContainerRect.x;
                const normalizedY = cursorPoint.y - displayContainerRect.y;
                if (
                    normalizedX <= 0 ||
                    normalizedX >= displayContainerRect.width ||
                    normalizedY <= 0 ||
                    normalizedY >= displayContainerRect.height
                ) {
                    layoutModel.treeReducer({ type: LayoutTreeActionType.ClearPendingAction });
                }
            }
        }),
        [getCursorPoint]
    );

    // Effect to detect when the cursor leaves the TileLayout hit trap so we can remove any placeholders. This cannot be done using pointer capture
    // because that conflicts with the DnD layer.
    useEffect(() => checkForCursorBounds(dragClientOffset), [dragClientOffset]);

    // Ensure that we don't see any jostling in the layout when we're rendering it the first time.
    // `animate` will be disabled until after the transforms have all applied the first time.
    const [animate, setAnimate] = useState(false);
    useEffect(() => {
        setTimeout(() => {
            setAnimate(true);
            setReady(true);
        }, 50);
    }, []);

    const gapSizePx = useAtomValue(layoutModel.gapSizePx);
    const animationTimeS = useAtomValue(layoutModel.animationTimeS);
    const tileStyle = useMemo(
        () =>
            ({
                "--gap-size-px": `${gapSizePx}px`,
                "--animation-time-s": `${animationTimeS}s`,
            }) as CSSProperties,
        [gapSizePx, animationTimeS]
    );

    return (
        <Suspense>
            <div
                className={clsx("tile-layout", contents.className, { animate: animate && !isResizing })}
                style={tileStyle}
            >
                <div key="display" ref={layoutModel.displayContainerRef} className="display-container">
                    <ResizeHandleWrapper layoutModel={layoutModel} />
                    <DisplayNodesWrapper layoutModel={layoutModel} />
                    <BoxHandlesWrapper layoutModel={layoutModel} />
                    <SnapPreview layoutModel={layoutModel} />
                    <NodeBackdrops layoutModel={layoutModel} />
                </div>
                <Placeholder key="placeholder" layoutModel={layoutModel} style={{ top: 10000, ...overlayTransform }} />
                <OverlayNodeWrapper layoutModel={layoutModel} />
            </div>
        </Suspense>
    );
}
export const TileLayout = memo(TileLayoutComponent) as typeof TileLayoutComponent;

function NodeBackdrops({ layoutModel }: { layoutModel: LayoutModel }) {
    const [blockBlurAtom] = useState(() => getSettingsKeyAtom("window:magnifiedblockblursecondarypx"));
    const blockBlur = useAtomValue(blockBlurAtom);
    const ephemeralNode = useAtomValue(layoutModel.ephemeralNode);
    const magnifiedNodeId = useAtomValue(layoutModel.magnifiedNodeIdAtom);

    const [showMagnifiedBackdrop, setShowMagnifiedBackdrop] = useState(!!ephemeralNode);
    const [showEphemeralBackdrop, setShowEphemeralBackdrop] = useState(!!magnifiedNodeId);

    const debouncedSetMagnifyBackdrop = useCallback(
        debounce(100, () => setShowMagnifiedBackdrop(true)),
        []
    );

    useEffect(() => {
        if (magnifiedNodeId && !showMagnifiedBackdrop) {
            debouncedSetMagnifyBackdrop();
        }
        if (!magnifiedNodeId) {
            setShowMagnifiedBackdrop(false);
        }
        if (ephemeralNode && !showEphemeralBackdrop) {
            setShowEphemeralBackdrop(true);
        }
        if (!ephemeralNode) {
            setShowEphemeralBackdrop(false);
        }
    }, [ephemeralNode, magnifiedNodeId]);

    const blockBlurStr = `${blockBlur}px`;

    return (
        <>
            {showMagnifiedBackdrop && (
                <div
                    className="magnified-node-backdrop"
                    onClick={() => {
                        layoutModel.magnifyNodeToggle(magnifiedNodeId);
                    }}
                    style={{ "--block-blur": blockBlurStr } as CSSProperties}
                />
            )}
            {showEphemeralBackdrop && (
                <div
                    className="ephemeral-node-backdrop"
                    onClick={() => {
                        layoutModel.closeNode(ephemeralNode?.id);
                    }}
                    style={{ "--block-blur": blockBlurStr } as CSSProperties}
                />
            )}
        </>
    );
}

interface DisplayNodesWrapperProps {
    /**
     * The layout tree state.
     */
    layoutModel: LayoutModel;
}

const DisplayNodesWrapper = ({ layoutModel }: DisplayNodesWrapperProps) => {
    const leafs = useAtomValue(layoutModel.leafs);

    return useMemo(
        () =>
            leafs.map((node) => {
                return <DisplayNode key={node.id} layoutModel={layoutModel} node={node} />;
            }),
        [leafs]
    );
};

interface DisplayNodeProps {
    layoutModel: LayoutModel;
    /**
     * The leaf node object, containing the data needed to display the leaf contents to the user.
     */
    node: LayoutNode;
}

/**
 * The draggable and displayable portion of a leaf node in a layout tree.
 */
const DisplayNode = ({ layoutModel, node }: DisplayNodeProps) => {
    const nodeModel = useNodeModel(layoutModel, node);
    const tileNodeRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const addlProps = useAtomValue(nodeModel.additionalProps);
    const devicePixelRatio = useDevicePixelRatio();
    const isEphemeral = useAtomValue(nodeModel.isEphemeral);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const isFloating = useAtomValue(nodeModel.isFloating);
    const numLeafs = useAtomValue(nodeModel.numLeafs);

    const [{ isDragging }, drag, dragPreview] = useDrag(
        () => ({
            type: tileItemType,
            canDrag: () => !(isEphemeral || isMagnified || isFloating),
            item: () => node,
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        }),
        [node, addlProps, isEphemeral, isMagnified, isFloating]
    );

    // A floating block is moved by its header, like a window by its title bar. Text fields in the header keep the
    // pointer for themselves.
    const boxMoveHandlers = useBoxDrag(layoutModel, node.id, "move", {}, (event) => {
        const target = event.target as HTMLElement;
        return (
            isFloating &&
            !isMagnified &&
            nodeModel.dragHandleRef.current?.contains(target) &&
            target.closest("input, textarea, select, [contenteditable='true']") == null
        );
    });

    const [previewElementGeneration, setPreviewElementGeneration] = useState(0);
    const previewElement = useMemo(() => {
        setPreviewElementGeneration(previewElementGeneration + 1);
        return (
            <div key="preview" className="tile-preview-container">
                <div
                    className="tile-preview"
                    ref={previewRef}
                    style={{
                        width: DragPreviewWidth,
                        height: DragPreviewHeight,
                        transform: `scale(${1 / devicePixelRatio})`,
                    }}
                >
                    {layoutModel.renderPreview?.(nodeModel)}
                </div>
            </div>
        );
    }, [devicePixelRatio, nodeModel]);

    const [previewImage, setPreviewImage] = useState<HTMLImageElement>(null);
    const [previewImageGeneration, setPreviewImageGeneration] = useState(0);
    const generatePreviewImage = useCallback(() => {
        const offsetX = (DragPreviewWidth * devicePixelRatio - DragPreviewWidth) / 2 + 10;
        const offsetY = (DragPreviewHeight * devicePixelRatio - DragPreviewHeight) / 2 + 10;
        if (previewImage !== null && previewElementGeneration === previewImageGeneration) {
            dragPreview(previewImage, { offsetY, offsetX });
        } else if (previewRef.current) {
            setPreviewImageGeneration(previewElementGeneration);
            toPng(previewRef.current).then((url) => {
                const img = new Image();
                img.src = url;
                setPreviewImage(img);
                dragPreview(img, { offsetY, offsetX });
            });
        }
    }, [
        dragPreview,
        previewRef.current,
        previewElementGeneration,
        previewImageGeneration,
        previewImage,
        devicePixelRatio,
    ]);

    const leafContent = useMemo(() => {
        return (
            <div key="leaf" className="tile-leaf">
                {layoutModel.renderContent(nodeModel)}
            </div>
        );
    }, [nodeModel]);

    // Register the display node as a draggable item. A floating block is not one: it follows the pointer directly,
    // and an element that the browser may drag would take the pointer away from it.
    useEffect(() => {
        drag(isFloating ? null : nodeModel.dragHandleRef);
    }, [drag, nodeModel.dragHandleRef.current, isFloating]);

    return (
        <div
            className={clsx("tile-node", {
                dragging: isDragging,
                floating: isFloating,
                spaced: numLeafs > 1,
            })}
            key={node.id}
            ref={tileNodeRef}
            id={node.id}
            style={addlProps?.transform}
            onPointerEnter={generatePreviewImage}
            onPointerOver={(event) => event.stopPropagation()}
            {...boxMoveHandlers}
        >
            {leafContent}
            {previewElement}
        </div>
    );
};

interface OverlayNodeWrapperProps {
    layoutModel: LayoutModel;
}

const OverlayNodeWrapper = memo(({ layoutModel }: OverlayNodeWrapperProps) => {
    const leafs = useAtomValue(layoutModel.leafs);
    const floatingNodeIds = useAtomValue(layoutModel.floatingNodeIds);
    const overlayTransform = useAtomValue(layoutModel.overlayTransform);

    // a floating block has no place in the tree, so a tile cannot be dropped next to it
    const overlayNodes = useMemo(
        () =>
            leafs
                .filter((node) => !floatingNodeIds.has(node.id))
                .map((node) => {
                    return <OverlayNode key={node.id} layoutModel={layoutModel} node={node} />;
                }),
        [leafs, floatingNodeIds]
    );

    return (
        <div key="overlay" className="overlay-container" style={{ top: 10000, ...overlayTransform }}>
            {overlayNodes}
        </div>
    );
});

interface OverlayNodeProps {
    /**
     * The layout tree state.
     */
    layoutModel: LayoutModel;
    node: LayoutNode;
}

/**
 * An overlay representing the true flexbox layout of the LayoutTreeState. This holds the drop targets for moving around nodes and is used to calculate the
 * dimensions of the corresponding DisplayNode for each LayoutTreeState leaf.
 */
const OverlayNode = memo(({ node, layoutModel }: OverlayNodeProps) => {
    const nodeModel = useNodeModel(layoutModel, node);
    const additionalProps = useAtomValue(nodeModel.additionalProps);
    const overlayRef = useRef<HTMLDivElement>(null);

    const [, drop] = useDrop(
        () => ({
            accept: tileItemType,
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<LayoutNode>();
                if (monitor.isOver({ shallow: true }) && dragItem.id !== node.id) {
                    return true;
                }
                return false;
            },
            drop: (_, monitor) => {
                if (!monitor.didDrop()) {
                    layoutModel.onDrop();
                }
            },
            hover: throttle(50, (_, monitor: DropTargetMonitor<unknown, unknown>) => {
                if (monitor.isOver({ shallow: true })) {
                    if (monitor.canDrop() && layoutModel.displayContainerRef?.current && additionalProps?.rect) {
                        const dragItem = monitor.getItem<LayoutNode>();
                        // console.log("computing operation", layoutNode, dragItem, additionalProps.rect);
                        const offset = monitor.getClientOffset();
                        const containerRect = layoutModel.displayContainerRef.current.getBoundingClientRect();
                        offset.x -= containerRect.x;
                        offset.y -= containerRect.y;
                        layoutModel.treeReducer({
                            type: LayoutTreeActionType.ComputeMove,
                            nodeId: node.id,
                            nodeToMoveId: dragItem.id,
                            direction: determineDropDirection(additionalProps.rect, offset),
                        } as LayoutTreeComputeMoveNodeAction);
                    } else {
                        layoutModel.treeReducer({
                            type: LayoutTreeActionType.ClearPendingAction,
                        });
                    }
                }
            }),
        }),
        [node.id, additionalProps?.rect, layoutModel.displayContainerRef, layoutModel.onDrop, layoutModel.treeReducer]
    );

    // Register the overlay node as a drop target
    useEffect(() => {
        drop(overlayRef);
    }, []);

    return <div ref={overlayRef} className="overlay-node" id={node.id} style={additionalProps?.transform} />;
});

interface ResizeHandleWrapperProps {
    layoutModel: LayoutModel;
}

const ResizeHandleWrapper = memo(({ layoutModel }: ResizeHandleWrapperProps) => {
    const resizeHandles = useAtomValue(layoutModel.resizeHandles) as Atom<ResizeHandleProps>[];

    return resizeHandles.map((resizeHandleAtom, i) => (
        <ResizeHandle key={`resize-handle-${i}`} layoutModel={layoutModel} resizeHandleAtom={resizeHandleAtom} />
    ));
});

interface ResizeHandleComponentProps {
    resizeHandleAtom: Atom<ResizeHandleProps>;
    layoutModel: LayoutModel;
}

const ResizeHandle = memo(({ resizeHandleAtom, layoutModel }: ResizeHandleComponentProps) => {
    const resizeHandleProps = useAtomValue(resizeHandleAtom);
    const resizeHandleRef = useRef<HTMLDivElement>(null);

    // The pointer currently captured, or undefined.
    const [trackingPointer, setTrackingPointer] = useState<number>(undefined);

    // Calculates the new size of the two nodes on either side of the handle, based on the position of the cursor
    const handlePointerMove = useCallback(
        throttle(10, (event: React.PointerEvent<HTMLDivElement>) => {
            if (trackingPointer === event.pointerId) {
                const { clientX, clientY } = event;
                layoutModel.onResizeMove(resizeHandleProps, clientX, clientY);
            }
        }),
        [trackingPointer, layoutModel.onResizeMove, resizeHandleProps]
    );

    // We want to use pointer capture so the operation continues even if the pointer leaves the bounds of the handle
    function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        resizeHandleRef.current?.setPointerCapture(event.pointerId);
    }

    // This indicates that we're ready to start tracking the resize operation via the pointer
    function onPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
        setTrackingPointer(event.pointerId);
    }

    // We want to wait a bit before committing the pending resize operation in case some events haven't arrived yet.
    const onPointerRelease = useCallback(
        debounce(30, (event: React.PointerEvent<HTMLDivElement>) => {
            setTrackingPointer(undefined);
            layoutModel.onResizeEnd();
        }),
        [layoutModel]
    );

    return (
        <div
            ref={resizeHandleRef}
            className={clsx("resize-handle", `flex-${resizeHandleProps.flexDirection}`)}
            onPointerDown={onPointerDown}
            onGotPointerCapture={onPointerCapture}
            onLostPointerCapture={onPointerRelease}
            style={resizeHandleProps.transform}
            onPointerMove={handlePointerMove}
        >
            <div className="line" />
        </div>
    );
});

interface BoxHandlesWrapperProps {
    layoutModel: LayoutModel;
}

/**
 * The handles on the edges of the boxes that are resized on their own: the floating blocks, and the area the tiles
 * fill.
 */
const BoxHandlesWrapper = memo(({ layoutModel }: BoxHandlesWrapperProps) => {
    const boxFrames = useAtomValue(layoutModel.boxFrames);
    return boxFrames.map((frame) => <BoxHandles key={frame.id} layoutModel={layoutModel} frame={frame} />);
});
BoxHandlesWrapper.displayName = "BoxHandlesWrapper";

const BoxHandleEdges: Record<string, BoxEdges> = {
    left: { left: true },
    right: { right: true },
    top: { top: true },
    bottom: { bottom: true },
    topleft: { top: true, left: true },
    topright: { top: true, right: true },
    bottomleft: { bottom: true, left: true },
    bottomright: { bottom: true, right: true },
};

// Where the strip that grabs one edge of a box lies across that edge: [offset from the edge, thickness].
function boxHandleStrip(edgePos: number, containerSize: number): [number, number] {
    if (edgePos <= 1) {
        return [0, BoxEdgeHandleSizePx];
    }
    if (edgePos >= containerSize - 1) {
        return [-BoxEdgeHandleSizePx, BoxEdgeHandleSizePx];
    }
    return [-BoxHandleSizePx / 2, BoxHandleSizePx];
}

function boxHandleRect(name: string, rect: Dimensions, container: Dimensions): Dimensions {
    const edges = BoxHandleEdges[name];
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const isCorner = Object.keys(edges).length == 2;
    let left = rect.left + BoxCornerSizePx;
    let width = rect.width - 2 * BoxCornerSizePx;
    let top = rect.top + BoxCornerSizePx;
    let height = rect.height - 2 * BoxCornerSizePx;
    if (edges.left || edges.right) {
        const edgePos = edges.left ? rect.left : right;
        const [offset, thickness] = boxHandleStrip(edgePos, container.width);
        left = edgePos + offset;
        width = thickness;
        if (isCorner) {
            left = edges.left ? left : edgePos + offset + thickness - BoxCornerSizePx;
            width = BoxCornerSizePx;
        }
    }
    if (edges.top || edges.bottom) {
        const edgePos = edges.top ? rect.top : bottom;
        const [offset, thickness] = boxHandleStrip(edgePos, container.height);
        top = edgePos + offset;
        height = thickness;
        if (isCorner) {
            top = edges.top ? top : edgePos + offset + thickness - BoxCornerSizePx;
            height = BoxCornerSizePx;
        }
    }
    return { left, top, width, height };
}

interface BoxHandlesProps {
    layoutModel: LayoutModel;
    frame: BoxFrameProps;
}

const BoxHandles = memo(({ layoutModel, frame }: BoxHandlesProps) => {
    // corners are for windows; the area the tiles fill is resized one edge at a time
    const names = frame.floating
        ? ["left", "right", "top", "bottom", "topleft", "topright", "bottomleft", "bottomright"]
        : ["left", "right", "top", "bottom"];
    return names.map((name) => <BoxHandle key={name} layoutModel={layoutModel} frame={frame} name={name} />);
});
BoxHandles.displayName = "BoxHandles";

interface BoxHandleProps extends BoxHandlesProps {
    name: string;
}

const BoxHandle = memo(({ layoutModel, frame, name }: BoxHandleProps) => {
    const handlers = useBoxDrag(layoutModel, frame.id, "resize", BoxHandleEdges[name]);
    const style = useMemo(() => {
        const container = layoutModel.getBoundingRect();
        return { ...setTransform(boxHandleRect(name, frame.rect, container), true, false), zIndex: frame.zIndex };
    }, [frame.rect, frame.zIndex, name]);
    // double-clicking an edge of the tiled area gives the tiles the whole container back
    const onDoubleClick = frame.id === TilesBoxId ? () => layoutModel.resetTileRect() : undefined;
    return (
        <div
            className={clsx("box-handle", `box-handle-${name}`)}
            style={style}
            onDoubleClick={onDoubleClick}
            {...handlers}
        >
            <div className="line" />
        </div>
    );
});
BoxHandle.displayName = "BoxHandle";

/**
 * Shows where a floating block will land if it is dropped in the zone it is being dragged into.
 */
const SnapPreview = memo(({ layoutModel }: { layoutModel: LayoutModel }) => {
    const snapPreview = useAtomValue(layoutModel.snapPreview);
    if (snapPreview == null) {
        return null;
    }
    return <div className="snap-preview" style={setTransform(snapPreview)} />;
});
SnapPreview.displayName = "SnapPreview";

interface PlaceholderProps {
    /**
     * The layout tree state.
     */
    layoutModel: LayoutModel;
    /**
     * Any styling to apply to the placeholder container div.
     */
    style: React.CSSProperties;
}

/**
 * An overlay to preview pending actions on the layout tree.
 */
const Placeholder = memo(({ layoutModel, style }: PlaceholderProps) => {
    const [placeholderOverlay, setPlaceholderOverlay] = useState<ReactNode>(null);
    const placeholderTransform = useAtomValue(layoutModel.placeholderTransform);

    useEffect(() => {
        if (placeholderTransform) {
            setPlaceholderOverlay(<div className="placeholder" style={placeholderTransform} />);
        } else {
            setPlaceholderOverlay(null);
        }
    }, [placeholderTransform]);

    return (
        <div className="placeholder-container" style={style}>
            {placeholderOverlay}
        </div>
    );
});
