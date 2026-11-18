// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { getSettingsKeyAtom } from "@/app/store/global";
import { BlockService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { atomWithThrottle, boundNumber, fireAndForget } from "@/util/util";
import { Atom, atom, Getter, PrimitiveAtom, Setter } from "jotai";
import { splitAtom } from "jotai/utils";
import { createRef, CSSProperties } from "react";
import { debounce } from "throttle-debounce";
import {
    Box,
    BoxEdges,
    collectSnapLines,
    findFreeRect,
    findLinkedBoxes,
    followResize,
    isFullRect,
    keepReachable,
    LinkedBox,
    placeNewFloat,
    resizeBox,
    resizeLimits,
    SnapLines,
    snapMove,
    SnapZone,
    splitRect,
    TilesBoxId,
    toFractions,
    toPixels,
    zoneAtPoint,
    zoneRect,
} from "./floating";
import { getLayoutStateAtomFromTab } from "./layoutAtom";
import { balanceNode, findNode, newLayoutNode, walkNodes } from "./layoutNode";
import {
    clearTree,
    computeMoveNode,
    deleteNode,
    focusNode,
    insertNode,
    insertNodeAtIndex,
    magnifyNodeToggle,
    moveNode,
    replaceNode,
    resizeNode,
    splitHorizontal,
    splitVertical,
    swapNode,
} from "./layoutTree";
import {
    BoxFrameProps,
    ContentRenderer,
    DefaultNodeSize,
    FlexDirection,
    FloatingNode,
    LayoutNode,
    LayoutNodeAdditionalProps,
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeClearTreeAction,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeDeleteNodeAction,
    LayoutTreeFocusNodeAction,
    LayoutTreeInsertNodeAction,
    LayoutTreeInsertNodeAtIndexAction,
    LayoutTreeMagnifyNodeToggleAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeReplaceNodeAction,
    LayoutTreeResizeNodeAction,
    LayoutTreeSetPendingAction,
    LayoutTreeSplitHorizontalAction,
    LayoutTreeSplitVerticalAction,
    LayoutTreeState,
    LayoutTreeSwapNodeAction,
    NavigateDirection,
    NavigationResult,
    NodeModel,
    PreviewRenderer,
    ResizeHandleProps,
    TileLayoutContents,
} from "./types";
import { getCenter, navigateDirectionToOffset, setTransform } from "./utils";

interface ResizeContext {
    handleId: string;
    pixelToSizeRatio: number;
    displayContainerRect?: Dimensions;
    resizeHandleStartPx: number;
    beforeNodeId: string;
    beforeNodeStartSize: number;
    afterNodeId: string;
    afterNodeStartSize: number;
}

/**
 * A floating block, or the area the tiles fill, while it is being moved or resized with the pointer.
 */
interface BoxDragContext {
    boxId: string;
    mode: "move" | "resize";
    edges: BoxEdges;
    startPointer: Point;
    startRect: Dimensions;
    container: Dimensions;
    /**
     * Where the layout container is in the window, to turn pointer positions into positions inside it.
     */
    containerOrigin: Point;
    linked: LinkedBox[];
    lines: SnapLines;
    /**
     * The rectangles of the other boxes, for the zones a moved block can be dropped into.
     */
    obstacles: Dimensions[];
    zone?: SnapZone;
    /**
     * The rectangles the boxes have while the drag lasts, in CSS pixels. They are stored when it ends.
     */
    pending: Map<string, Dimensions>;
}

const DefaultGapSizePx = 3;
const MinNodeSizePx = 40;
const DefaultAnimationTimeS = 0.15;
// Floating blocks are stacked from here up, two steps apart: one for the block, one for its resize handles. The
// values below this one and the ones from 1000 up belong to the tiles and to magnified blocks, see theme.scss.
const FloatZIndexBase = 10;
// the size of the container to assume while it is not on screen, as when a tab is loaded in the background
const NominalContainerRect: Dimensions = { left: 0, top: 0, width: 1600, height: 900 };

export class LayoutModel {
    /**
     * Local atom holding the current tree state (source of truth during runtime)
     */
    private localTreeStateAtom: PrimitiveAtom<LayoutTreeState>;
    /**
     * The tree state (local cache)
     */
    treeState: LayoutTreeState;
    /**
     * Reference to the tab atom for accessing WaveObject
     */
    private tabAtom: Atom<Tab>;
    /**
     * WaveObject atom for persistence
     */
    private waveObjectAtom: Atom<LayoutState>;
    /**
     * Debounce timer for persistence
     */
    private persistDebounceTimer: NodeJS.Timeout | null;
    /**
     * Set of action IDs that have been processed (prevents duplicate processing)
     */
    private processedActionIds: Set<string>;
    /**
     * The jotai getter that is used to read atom values.
     */
    getter: Getter;
    /**
     * The jotai setter that is used to update atom values.
     */
    setter: Setter;
    /**
     * Callback that is invoked to render the block associated with a leaf node.
     */
    renderContent?: ContentRenderer;
    /**
     * Callback that is invoked to render the drag preview for a leaf node.
     */
    renderPreview?: PreviewRenderer;
    /**
     * Callback that is invoked when a node is closed.
     */
    onNodeDelete?: (data: TabLayoutData) => Promise<void>;
    /**
     * The size of the gap between nodes in CSS pixels.
     */
    gapSizePx: PrimitiveAtom<number>;

    /**
     * The time a transition animation takes, in seconds.
     */
    animationTimeS: PrimitiveAtom<number>;

    /**
     * List of nodes that are leafs and should be rendered as a DisplayNode.
     */
    leafs: PrimitiveAtom<LayoutNode[]>;
    /**
     * An ordered list of node ids starting from the top left corner to the bottom right corner.
     */
    leafOrder: PrimitiveAtom<LeafOrderEntry[]>;
    /**
     * Atom representing the number of leaf nodes in a layout.
     */
    numLeafs: Atom<number>;
    /**
     * A map of node models for currently-active leafs.
     */
    private nodeModels: Map<string, NodeModel>;

    /**
     * Split atom containing the properties of all of the resize handles that should be placed in the layout.
     */
    resizeHandles: SplitAtom<ResizeHandleProps>;
    /**
     * Layout node derived properties that are not persisted to the backend.
     * @see updateTreeHelper for the logic to update these properties.
     */
    additionalProps: PrimitiveAtom<Record<string, LayoutNodeAdditionalProps>>;
    /**
     * Set if there is currently an uncommitted action pending on the layout tree.
     * @see LayoutTreeActionType for the different types of actions.
     */
    pendingTreeAction: AtomWithThrottle<LayoutTreeAction>;
    /**
     * Whether a node is currently being dragged.
     */
    activeDrag: PrimitiveAtom<boolean>;
    /**
     * Whether the overlay container should be shown.
     * @see overlayTransform contains the actual CSS transform that moves the overlay into view.
     */
    showOverlay: PrimitiveAtom<boolean>;
    /**
     * Whether the nodes within the layout should be displaying content.
     */
    ready: PrimitiveAtom<boolean>;

    /**
     * RefObject for the display container, that holds the display nodes. This is used to get the size of the whole layout.
     */
    displayContainerRef: React.RefObject<HTMLDivElement>;
    /**
     * CSS properties for the placeholder element.
     */
    placeholderTransform: Atom<CSSProperties>;
    /**
     * CSS properties for the overlay container.
     */
    overlayTransform: Atom<CSSProperties>;

    /**
     * The currently focused node.
     */
    private focusedNodeIdStack: string[];
    /**
     * Atom pointing to the currently focused node.
     */
    focusedNode: Atom<LayoutNode>;

    // TODO: Nodes that need to be placed at higher z-indices should probably be handled by an ordered list, rather than individual properties.
    /**
     * The currently magnified node.
     */
    magnifiedNodeId: string;
    /**
     * Atom for the magnified node ID (derived from local tree state)
     */
    magnifiedNodeIdAtom: Atom<string>;
    /**
     * The last node to be magnified, other than the current magnified node, if set. This node should sit at a higher z-index than the others so that it floats above the other nodes as it returns to its original position.
     */
    lastMagnifiedNodeId: string;
    /**
     * Atom holding an ephemeral node that is not part of the layout tree. This node displays above all other nodes.
     */
    ephemeralNode: PrimitiveAtom<LayoutNode>;
    /**
     * The last node to be an ephemeral node. This node should sit at a higher z-index than the others so that it floats above the other nodes as it returns to its original position.
     */
    lastEphemeralNodeId: string;
    magnifiedNodeSizeAtom: Atom<number>;

    /**
     * The size of the resize handles, in CSS pixels.
     * The resize handle size is double the gap size, or double the default gap size, whichever is greater.
     * @see gapSizePx @see DefaultGapSizePx
     */
    private resizeHandleSizePx: Atom<number>;
    /**
     * A context used by the resize handles to keep track of precomputed values for the current resize operation.
     */
    private resizeContext?: ResizeContext;
    /**
     * True if a resize handle is currently being dragged or the whole TileLayout container is being resized.
     */
    isResizing: Atom<boolean>;
    /**
     * True if the whole TileLayout container is being resized.
     */
    private isContainerResizing: PrimitiveAtom<boolean>;

    /**
     * The boxes that are resized by their own edges: the area the tiles fill, and each floating block.
     */
    boxFrames: PrimitiveAtom<BoxFrameProps[]>;
    /**
     * The ids of the floating nodes.
     */
    floatingNodeIds: Atom<Set<string>>;
    /**
     * Where a floating block will go if it is dropped now, when that is not where it is shown.
     */
    snapPreview: PrimitiveAtom<Dimensions>;
    /**
     * True while a box is being moved or resized with the pointer.
     */
    boxDragActive: PrimitiveAtom<boolean>;
    private boxDrag?: BoxDragContext;
    /**
     * Blocks should not take pointer events while something is being dragged over them.
     */
    private disablePointerEvents: Atom<boolean>;

    constructor(
        tabAtom: Atom<Tab>,
        getter: Getter,
        setter: Setter,
        renderContent?: ContentRenderer,
        renderPreview?: PreviewRenderer,
        onNodeDelete?: (data: TabLayoutData) => Promise<void>,
        gapSizePx?: number,
        animationTimeS?: number
    ) {
        this.tabAtom = tabAtom;
        this.getter = getter;
        this.setter = setter;
        this.renderContent = renderContent;
        this.renderPreview = renderPreview;
        this.onNodeDelete = onNodeDelete;
        this.gapSizePx = atom(gapSizePx ?? DefaultGapSizePx);
        this.resizeHandleSizePx = atom((get) => {
            const gapSizePx = get(this.gapSizePx);
            return 2 * (gapSizePx > 5 ? gapSizePx : DefaultGapSizePx);
        });
        this.animationTimeS = atom(animationTimeS ?? DefaultAnimationTimeS);
        this.persistDebounceTimer = null;
        this.processedActionIds = new Set();

        this.waveObjectAtom = getLayoutStateAtomFromTab(tabAtom, getter);

        this.localTreeStateAtom = atom<LayoutTreeState>({
            rootNode: undefined,
            focusedNodeId: undefined,
            magnifiedNodeId: undefined,
            leafOrder: undefined,
            pendingBackendActions: undefined,
        });

        this.treeState = {
            rootNode: undefined,
            focusedNodeId: undefined,
            magnifiedNodeId: undefined,
            leafOrder: undefined,
            pendingBackendActions: undefined,
        };

        this.leafs = atom([]);
        this.leafOrder = atom([]);
        this.numLeafs = atom((get) => get(this.leafOrder).length);

        this.nodeModels = new Map();
        this.additionalProps = atom({});

        const resizeHandleListAtom = atom((get) => {
            const addlProps = get(this.additionalProps);
            return Object.values(addlProps)
                .flatMap((props) => props.resizeHandles)
                .filter((v) => v);
        });
        this.resizeHandles = splitAtom(resizeHandleListAtom);
        this.isContainerResizing = atom(false);
        this.boxFrames = atom([]) as PrimitiveAtom<BoxFrameProps[]>;
        this.snapPreview = atom(null) as PrimitiveAtom<Dimensions>;
        this.boxDragActive = atom(false);
        this.isResizing = atom((get) => {
            const pendingAction = get(this.pendingTreeAction.throttledValueAtom);
            const isWindowResizing = get(this.isContainerResizing);
            return (
                isWindowResizing || get(this.boxDragActive) || pendingAction?.type === LayoutTreeActionType.ResizeNode
            );
        });
        this.floatingNodeIds = atom((get) => {
            const treeState = get(this.localTreeStateAtom);
            return new Set((treeState.floatingNodes ?? []).map((float) => float.node.id));
        });

        this.displayContainerRef = createRef();
        this.activeDrag = atom(false);
        this.disablePointerEvents = atom((get) => get(this.activeDrag) || get(this.boxDragActive));
        this.showOverlay = atom(false);
        this.ready = atom(false);
        this.overlayTransform = atom<CSSProperties>((get) => {
            const activeDrag = get(this.activeDrag);
            const showOverlay = get(this.showOverlay);
            if (this.displayContainerRef.current) {
                const displayBoundingRect = this.displayContainerRef.current.getBoundingClientRect();
                const newOverlayOffset = displayBoundingRect.top + 2 * displayBoundingRect.height;
                const newTransform = setTransform(
                    {
                        top: activeDrag || showOverlay ? 0 : newOverlayOffset,
                        left: 0,
                        width: displayBoundingRect.width,
                        height: displayBoundingRect.height,
                    },
                    false
                );
                return newTransform;
            }
        });

        this.ephemeralNode = atom();
        this.magnifiedNodeSizeAtom = getSettingsKeyAtom("window:magnifiedblocksize");

        this.magnifiedNodeIdAtom = atom((get) => {
            const treeState = get(this.localTreeStateAtom);
            return treeState.magnifiedNodeId;
        });

        this.focusedNode = atom((get) => {
            const ephemeralNode = get(this.ephemeralNode);
            const treeState = get(this.localTreeStateAtom);
            if (ephemeralNode) {
                return ephemeralNode;
            }
            if (treeState.focusedNodeId == null) {
                return null;
            }
            return (
                findNode(treeState.rootNode, treeState.focusedNodeId) ??
                treeState.floatingNodes?.find((float) => float.node.id === treeState.focusedNodeId)?.node
            );
        });
        this.focusedNodeIdStack = [];

        this.pendingTreeAction = atomWithThrottle<LayoutTreeAction>(null, 10);
        this.placeholderTransform = atom<CSSProperties>((get: Getter) => {
            const pendingAction = get(this.pendingTreeAction.throttledValueAtom);
            return this.getPlaceholderTransform(pendingAction);
        });

        this.initializeFromWaveObject();
    }

    private initializeFromWaveObject() {
        const waveObjState = this.getter(this.waveObjectAtom);

        const initialState: LayoutTreeState = {
            rootNode: waveObjState?.rootnode,
            floatingNodes: (waveObjState?.floatingnodes ?? []).map((float) => ({
                node: {
                    id: float.nodeid,
                    data: { blockId: float.blockid },
                    flexDirection: FlexDirection.Row,
                    size: DefaultNodeSize,
                },
                rect: float.rect,
            })),
            tileRect: waveObjState?.tilerect,
            lastFloatRect: waveObjState?.lastfloatrect,
            focusedNodeId: waveObjState?.focusednodeid,
            magnifiedNodeId: waveObjState?.magnifiednodeid,
            leafOrder: undefined,
            pendingBackendActions: waveObjState?.pendingbackendactions,
        };

        this.treeState = initialState;
        this.magnifiedNodeId = initialState.magnifiedNodeId;
        this.setter(this.localTreeStateAtom, { ...initialState });

        if (initialState.pendingBackendActions?.length) {
            fireAndForget(() => this.processPendingBackendActions());
        } else {
            this.updateTree();
        }
    }

    onBackendUpdate() {
        const waveObj = this.getter(this.waveObjectAtom);
        const pendingActions = waveObj?.pendingbackendactions;
        if (pendingActions?.length) {
            fireAndForget(() => this.processPendingBackendActions());
        }
    }

    private async processPendingBackendActions() {
        const waveObj = this.getter(this.waveObjectAtom);
        const actions = waveObj?.pendingbackendactions;
        if (!actions?.length) return;

        this.treeState.pendingBackendActions = undefined;

        for (const action of actions) {
            if (!action.actionid) {
                console.warn("Dropping layout action without actionid:", action);
                continue;
            }
            if (this.processedActionIds.has(action.actionid)) {
                continue;
            }
            this.processedActionIds.add(action.actionid);
            await this.handleBackendAction(action);
        }

        this.updateTree();
        this.setter(this.localTreeStateAtom, { ...this.treeState });
        this.persistToBackend();
    }

    private async cleanupOrphanedBlocks() {
        const tab = this.getter(this.tabAtom);
        const layoutBlockIds = new Set<string>();
        const floats = this.treeState.floatingNodes ?? [];

        if (this.treeState.rootNode == null && floats.length == 0) {
            return;
        }

        walkNodes(this.treeState.rootNode, (node) => {
            if (node.data?.blockId) {
                layoutBlockIds.add(node.data.blockId);
            }
        });
        // a floating block is not in the tree, and is not an orphan for that
        for (const float of floats) {
            layoutBlockIds.add(float.node.data.blockId);
        }

        for (const blockId of tab.blockids || []) {
            if (!layoutBlockIds.has(blockId)) {
                console.log("Cleaning up orphaned block:", blockId);
                if (this.onNodeDelete) {
                    await this.onNodeDelete({ blockId });
                }
            }
        }
    }

    private async handleBackendAction(action: LayoutActionData) {
        switch (action.actiontype) {
            case LayoutTreeActionType.InsertNode: {
                if (action.ephemeral) {
                    this.newEphemeralNode(action.blockid);
                    break;
                }
                const newNode = newLayoutNode(undefined, undefined, undefined, {
                    blockId: action.blockid,
                });
                // A block that was not asked for from the layout itself (wsh view, wsh edit, wsh web open ...)
                // must not rearrange what is there: it floats, in the empty space if there is some.
                if (!action.magnified && this.hasNodes()) {
                    this.addFloatingNode(newNode, this.placeFloatingRect(), action.focused);
                    break;
                }
                const insertNodeAction: LayoutTreeInsertNodeAction = {
                    type: LayoutTreeActionType.InsertNode,
                    node: newNode,
                    magnified: action.magnified,
                    focused: action.focused,
                };
                this.treeReducer(insertNodeAction, false);
                break;
            }
            case LayoutTreeActionType.DeleteNode: {
                const leaf = this?.getNodeByBlockId(action.blockid);
                if (leaf) {
                    await this.closeNode(leaf.id);
                } else {
                    console.error(
                        "Cannot apply eventbus layout action DeleteNode, could not find leaf node with blockId",
                        action.blockid
                    );
                }
                break;
            }
            case LayoutTreeActionType.InsertNodeAtIndex: {
                if (!action.indexarr) {
                    console.error("Cannot apply eventbus layout action InsertNodeAtIndex, indexarr field is missing.");
                    break;
                }
                const insertAction: LayoutTreeInsertNodeAtIndexAction = {
                    type: LayoutTreeActionType.InsertNodeAtIndex,
                    node: newLayoutNode(undefined, action.nodesize, undefined, {
                        blockId: action.blockid,
                    }),
                    indexArr: action.indexarr,
                    magnified: action.magnified,
                    focused: action.focused,
                };
                this.treeReducer(insertAction, false);
                break;
            }
            case LayoutTreeActionType.ClearTree: {
                this.treeReducer(
                    {
                        type: LayoutTreeActionType.ClearTree,
                    } as LayoutTreeClearTreeAction,
                    false
                );
                break;
            }
            case LayoutTreeActionType.ReplaceNode: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action ReplaceNode, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                const replaceAction: LayoutTreeReplaceNodeAction = {
                    type: LayoutTreeActionType.ReplaceNode,
                    targetNodeId: targetNode.id,
                    newNode: newLayoutNode(undefined, action.nodesize, undefined, {
                        blockId: action.blockid,
                    }),
                };
                this.treeReducer(replaceAction, false);
                break;
            }
            case LayoutTreeActionType.SplitHorizontal: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action SplitHorizontal, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                if (action.position != "before" && action.position != "after") {
                    console.error(
                        "Cannot apply eventbus layout action SplitHorizontal, invalid position",
                        action.position
                    );
                    break;
                }
                const newNode = newLayoutNode(undefined, action.nodesize, undefined, {
                    blockId: action.blockid,
                });
                const splitAction: LayoutTreeSplitHorizontalAction = {
                    type: LayoutTreeActionType.SplitHorizontal,
                    targetNodeId: targetNode.id,
                    newNode: newNode,
                    position: action.position,
                };
                this.treeReducer(splitAction, false);
                break;
            }
            case LayoutTreeActionType.SplitVertical: {
                const targetNode = this?.getNodeByBlockId(action.targetblockid);
                if (!targetNode) {
                    console.error(
                        "Cannot apply eventbus layout action SplitVertical, could not find target node with blockId",
                        action.targetblockid
                    );
                    break;
                }
                if (action.position != "before" && action.position != "after") {
                    console.error(
                        "Cannot apply eventbus layout action SplitVertical, invalid position",
                        action.position
                    );
                    break;
                }
                const newNode = newLayoutNode(undefined, action.nodesize, undefined, {
                    blockId: action.blockid,
                });
                const splitAction: LayoutTreeSplitVerticalAction = {
                    type: LayoutTreeActionType.SplitVertical,
                    targetNodeId: targetNode.id,
                    newNode: newNode,
                    position: action.position,
                };
                this.treeReducer(splitAction, false);
                break;
            }
            case "cleanuporphaned": {
                await this.cleanupOrphanedBlocks();
                break;
            }
            default:
                console.warn("unsupported layout action", action);
                break;
        }
    }

    private persistToBackend() {
        if (this.persistDebounceTimer) {
            clearTimeout(this.persistDebounceTimer);
        }

        this.persistDebounceTimer = setTimeout(() => {
            const waveObj = this.getter(this.waveObjectAtom);
            if (!waveObj) return;

            waveObj.rootnode = this.treeState.rootNode;
            waveObj.floatingnodes = (this.treeState.floatingNodes ?? []).map((float) => ({
                nodeid: float.node.id,
                blockid: float.node.data.blockId,
                rect: float.rect,
            }));
            waveObj.tilerect = this.treeState.tileRect;
            waveObj.lastfloatrect = this.treeState.lastFloatRect;
            waveObj.focusednodeid = this.treeState.focusedNodeId;
            waveObj.magnifiednodeid = this.treeState.magnifiedNodeId;
            waveObj.leaforder = this.treeState.leafOrder;
            waveObj.pendingbackendactions = this.treeState.pendingBackendActions;

            WOS.setObjectValue(waveObj, this.setter, true);
            this.persistDebounceTimer = null;
        }, 100);
    }

    /**
     * Register TileLayout callbacks that should be called on various state changes.
     * @param contents Contains callbacks provided by the TileLayout component.
     */
    registerTileLayout(contents: TileLayoutContents) {
        this.renderContent = contents.renderContent;
        this.renderPreview = contents.renderPreview;
        this.onNodeDelete = contents.onNodeDelete;
        if (contents.gapSizePx !== undefined) {
            this.setter(this.gapSizePx, contents.gapSizePx);
        }
        const tab = this.getter(this.tabAtom);
        fireAndForget(() => BlockService.CleanupOrphanedBlocks(tab.oid));
    }

    /**
     * Perform an action against the layout tree state.
     * @param action The action to perform.
     */
    treeReducer(action: LayoutTreeAction, setState = true) {
        if (!this.reduceFloatingAction(action)) {
            this.reduceTreeAction(action);
        }
        if (this.treeState.rootNode == null) {
            // with no tiles left there is no area for them to keep
            this.treeState.tileRect = undefined;
        }
        if (this.magnifiedNodeId !== this.treeState.magnifiedNodeId) {
            this.lastMagnifiedNodeId = this.magnifiedNodeId;
            this.lastEphemeralNodeId = undefined;
            this.magnifiedNodeId = this.treeState.magnifiedNodeId;
        }
        if (setState) {
            this.commitTreeState();
        }
    }

    /**
     * Recompute the layout from the tree state, publish it and save it.
     */
    private commitTreeState() {
        this.updateTree();
        this.setter(this.localTreeStateAtom, { ...this.treeState });
        this.persistToBackend();
    }

    private reduceTreeAction(action: LayoutTreeAction) {
        switch (action.type) {
            case LayoutTreeActionType.ComputeMove:
                this.setter(
                    this.pendingTreeAction.throttledValueAtom,
                    computeMoveNode(this.treeState, action as LayoutTreeComputeMoveNodeAction)
                );
                break;
            case LayoutTreeActionType.Move:
                moveNode(this.treeState, action as LayoutTreeMoveNodeAction);
                break;
            case LayoutTreeActionType.InsertNode:
                insertNode(this.treeState, action as LayoutTreeInsertNodeAction);
                break;
            case LayoutTreeActionType.InsertNodeAtIndex:
                insertNodeAtIndex(this.treeState, action as LayoutTreeInsertNodeAtIndexAction);
                break;
            case LayoutTreeActionType.DeleteNode:
                deleteNode(this.treeState, action as LayoutTreeDeleteNodeAction);
                break;
            case LayoutTreeActionType.Swap:
                swapNode(this.treeState, action as LayoutTreeSwapNodeAction);
                break;
            case LayoutTreeActionType.ResizeNode:
                resizeNode(this.treeState, action as LayoutTreeResizeNodeAction);
                break;
            case LayoutTreeActionType.SetPendingAction: {
                const pendingAction = (action as LayoutTreeSetPendingAction).action;
                if (pendingAction) {
                    this.setter(this.pendingTreeAction.throttledValueAtom, pendingAction);
                } else {
                    console.warn("No new pending action provided");
                }
                break;
            }
            case LayoutTreeActionType.ClearPendingAction:
                this.setter(this.pendingTreeAction.throttledValueAtom, undefined);
                break;
            case LayoutTreeActionType.CommitPendingAction: {
                const pendingAction = this.getter(this.pendingTreeAction.currentValueAtom);
                if (!pendingAction) {
                    console.error("unable to commit pending action, does not exist");
                    break;
                }
                this.treeReducer(pendingAction);
                this.setter(this.pendingTreeAction.throttledValueAtom, undefined);
                break;
            }
            case LayoutTreeActionType.FocusNode:
                focusNode(this.treeState, action as LayoutTreeFocusNodeAction);
                break;
            case LayoutTreeActionType.MagnifyNodeToggle:
                magnifyNodeToggle(this.treeState, action as LayoutTreeMagnifyNodeToggleAction);
                break;
            case LayoutTreeActionType.ClearTree:
                clearTree(this.treeState);
                break;
            case LayoutTreeActionType.ReplaceNode:
                replaceNode(this.treeState, action as LayoutTreeReplaceNodeAction);
                break;
            case LayoutTreeActionType.SplitHorizontal:
                splitHorizontal(this.treeState, action as LayoutTreeSplitHorizontalAction);
                break;
            case LayoutTreeActionType.SplitVertical:
                splitVertical(this.treeState, action as LayoutTreeSplitVerticalAction);
                break;
            default:
                console.error("Invalid reducer action", this.treeState, action);
        }
    }

    /**
     * Handles the actions that concern a floating block, or that should produce one.
     * @returns Whether the action was handled, in which case it must not be applied to the tree.
     */
    private reduceFloatingAction(action: LayoutTreeAction): boolean {
        switch (action.type) {
            case LayoutTreeActionType.InsertNode: {
                // A new block goes into empty space when there is some, instead of making the tiles smaller.
                const insertAction = action as LayoutTreeInsertNodeAction;
                if (insertAction.magnified || !insertAction.node || !this.hasNodes()) {
                    return false;
                }
                const freeRect = findFreeRect(this.getContainerRect(), this.getObstacles());
                if (freeRect == null) {
                    return false;
                }
                this.addFloatingNode(insertAction.node, freeRect, insertAction.focused);
                return true;
            }
            case LayoutTreeActionType.DeleteNode: {
                const nodeId = (action as LayoutTreeDeleteNodeAction).nodeId;
                const float = this.getFloatingNode(nodeId);
                if (!float) {
                    return false;
                }
                this.treeState.floatingNodes = this.treeState.floatingNodes.filter((f) => f !== float);
                this.treeState.lastFloatRect = float.rect;
                if (this.treeState.focusedNodeId === nodeId) {
                    this.treeState.focusedNodeId = undefined;
                }
                return true;
            }
            case LayoutTreeActionType.SplitHorizontal:
            case LayoutTreeActionType.SplitVertical: {
                const splitAction = action as LayoutTreeSplitHorizontalAction | LayoutTreeSplitVerticalAction;
                const float = this.getFloatingNode(splitAction.targetNodeId);
                if (!float) {
                    return false;
                }
                const direction = action.type === LayoutTreeActionType.SplitHorizontal ? "row" : "column";
                const container = this.getContainerRect();
                const { kept, added } = splitRect(toPixels(float.rect, container), direction, splitAction.position);
                float.rect = toFractions(kept, container);
                this.treeState.floatingNodes = [
                    ...this.treeState.floatingNodes,
                    { node: splitAction.newNode, rect: toFractions(added, container) },
                ];
                if (splitAction.focused) {
                    this.treeState.focusedNodeId = splitAction.newNode.id;
                }
                return true;
            }
            case LayoutTreeActionType.ReplaceNode: {
                const replaceAction = action as LayoutTreeReplaceNodeAction;
                const float = this.getFloatingNode(replaceAction.targetNodeId);
                if (!float) {
                    return false;
                }
                float.node = replaceAction.newNode;
                if (replaceAction.focused) {
                    this.treeState.focusedNodeId = replaceAction.newNode.id;
                }
                return true;
            }
            case LayoutTreeActionType.MagnifyNodeToggle: {
                const nodeId = (action as LayoutTreeMagnifyNodeToggleAction).nodeId;
                if (!this.getFloatingNode(nodeId)) {
                    return false;
                }
                if (this.treeState.magnifiedNodeId === nodeId) {
                    this.treeState.magnifiedNodeId = undefined;
                } else {
                    this.treeState.magnifiedNodeId = nodeId;
                    this.treeState.focusedNodeId = nodeId;
                }
                return true;
            }
            case LayoutTreeActionType.ClearTree:
                this.treeState.floatingNodes = [];
                this.treeState.tileRect = undefined;
                this.treeState.lastFloatRect = undefined;
                return false;
            default:
                return false;
        }
    }

    /**
     * Callback that is invoked when the upstream tree state has been updated. This ensures the model is updated if the atom is not fully loaded when the model is first instantiated.
     * @param force Whether to force the local tree state to update, regardless of whether the state is already up to date.
     */
    async onTreeStateAtomUpdated(force = false) {
        if (force) {
            this.updateTree();
            this.setter(this.localTreeStateAtom, { ...this.treeState });
        }
    }

    /**
     * Set the upstream tree state atom to the value of the local tree state.
     * @param bumpGeneration Whether to bump the generation of the tree state before setting the atom.
     */

    /**
     * Recursively walks the tree to find leaf nodes, update the resize handles, and compute additional properties for each node.
     * @param balanceTree Whether the tree should also be balanced as it is walked. This should be done if the tree state has just been updated. Defaults to true.
     */
    updateTree(balanceTree = true) {
        if (this.displayContainerRef.current) {
            const newLeafs: LayoutNode[] = [];
            const newAdditionalProps = {};

            const pendingAction = this.getter(this.pendingTreeAction.currentValueAtom);
            const resizeAction =
                pendingAction?.type === LayoutTreeActionType.ResizeNode
                    ? (pendingAction as LayoutTreeResizeNodeAction)
                    : null;
            const resizeHandleSizePx = this.getter(this.resizeHandleSizePx);

            const boundingRect = this.getBoundingRect();
            const tileRect = this.getTileRectPx(boundingRect);
            const floats = this.treeState.floatingNodes ?? [];

            const magnifiedNodeSize = this.getter(this.magnifiedNodeSizeAtom);

            // A block that is alone in the layout cannot be magnified. This has to be settled before the walk, which
            // is where the magnified block gets its place.
            if (this.magnifiedNodeId != null && this.countLeafs() <= 1) {
                this.treeState.magnifiedNodeId = undefined;
                this.magnifiedNodeId = undefined;
            }

            // A tile that is alone has no parent to give it a rectangle, and is sized by CSS to fill the container.
            // That is not enough once the tiles do not fill the container, or once floating blocks have to be
            // placed relative to it.
            const rootNode = this.treeState.rootNode;
            if (rootNode != null && !rootNode.children && (floats.length > 0 || this.hasTileRect())) {
                newAdditionalProps[rootNode.id] = { treeKey: "0", rect: tileRect, transform: setTransform(tileRect) };
            }

            const callback = (node: LayoutNode) =>
                this.updateTreeHelper(
                    node,
                    newAdditionalProps,
                    newLeafs,
                    resizeHandleSizePx,
                    magnifiedNodeSize,
                    boundingRect,
                    tileRect,
                    resizeAction
                );
            if (balanceTree) this.treeState.rootNode = balanceNode(this.treeState.rootNode, callback);
            else walkNodes(this.treeState.rootNode, callback);

            const boxFrames: BoxFrameProps[] = [];
            if (this.treeState.rootNode != null) {
                boxFrames.push({
                    id: TilesBoxId,
                    floating: false,
                    rect: tileRect,
                    zIndex: "var(--zindex-layout-resize-handle)",
                });
            }
            floats.forEach((float, idx) => {
                const nodeId = float.node.id;
                const rect = this.boxDrag?.pending.get(nodeId) ?? toPixels(float.rect, boundingRect);
                const zIndex = FloatZIndexBase + 2 * idx;
                newAdditionalProps[nodeId] = {
                    // after every tile, which all have a key that starts with 0
                    treeKey: "1" + String(idx).padStart(3, "0"),
                    rect,
                    transform:
                        this.magnifiedNodeId === nodeId
                            ? this.getMagnifiedTransform(boundingRect, magnifiedNodeSize)
                            : setTransform(rect, true, true, zIndex),
                };
                newLeafs.push(float.node);
                boxFrames.push({ id: nodeId, floating: true, rect, zIndex: zIndex + 1 });
            });
            // In an order that does not depend on the stacking, like the leafs below: an element that React moves
            // in the DOM loses the pointer it has captured, and a block is brought to the front as its drag begins.
            this.setter(
                this.boxFrames,
                boxFrames.sort((a, b) => a.id.localeCompare(b.id))
            );

            // Process ephemeral node, if present.
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode) {
                this.updateEphemeralNodeProps(
                    ephemeralNode,
                    newAdditionalProps,
                    newLeafs,
                    magnifiedNodeSize,
                    boundingRect
                );
            }

            this.treeState.leafOrder = getLeafOrder(newLeafs, newAdditionalProps);
            this.validateFocusedNode(this.treeState.leafOrder);
            this.validateMagnifiedNode(this.treeState.leafOrder, newAdditionalProps);
            this.cleanupNodeModels(this.treeState.leafOrder);
            this.setter(
                this.leafs,
                newLeafs.sort((a, b) => a.id.localeCompare(b.id))
            );
            this.setter(this.leafOrder, this.treeState.leafOrder);
            this.setter(this.additionalProps, newAdditionalProps);
        }
    }

    /**
     * Per-node callback that is invoked recursively to find leaf nodes, update the resize handles, and compute additional properties associated with the given node.
     * @param node The node for which to update the resize handles and additional properties.
     * @param additionalPropsMap The new map that will contain the updated additional properties for all nodes in the tree.
     * @param leafs The new list that will contain all the leaf nodes in the tree.
     * @param resizeAction The pending resize action, if any. Used to set temporary size values on nodes that are being resized.
     */
    private updateTreeHelper(
        node: LayoutNode,
        additionalPropsMap: Record<string, LayoutNodeAdditionalProps>,
        leafs: LayoutNode[],
        resizeHandleSizePx: number,
        magnifiedNodeSizePct: number,
        boundingRect: Dimensions,
        tileRect: Dimensions,
        resizeAction?: LayoutTreeResizeNodeAction
    ) {
        if (!node.children?.length) {
            leafs.push(node);
            const addlProps = additionalPropsMap[node.id];
            if (addlProps) {
                if (this.magnifiedNodeId === node.id) {
                    addlProps.transform = this.getMagnifiedTransform(boundingRect, magnifiedNodeSizePct);
                }
                if (this.lastMagnifiedNodeId === node.id) {
                    addlProps.transform.zIndex = "var(--zindex-layout-last-magnified-node)";
                } else if (this.lastEphemeralNodeId === node.id) {
                    addlProps.transform.zIndex = "var(--zindex-layout-last-ephemeral-node)";
                }
            }
            return;
        }

        function getNodeSize(node: LayoutNode) {
            return resizeAction?.resizeOperations.find((op) => op.nodeId === node.id)?.size ?? node.size;
        }

        const additionalProps: LayoutNodeAdditionalProps =
            node.id in additionalPropsMap ? additionalPropsMap[node.id] : { treeKey: "0" };

        const nodeRect: Dimensions = node.id === this.treeState.rootNode.id ? tileRect : additionalProps.rect;
        const nodeIsRow = node.flexDirection === FlexDirection.Row;
        const nodePixels = nodeIsRow ? nodeRect.width : nodeRect.height;
        const totalChildrenSize = node.children.reduce((acc, child) => acc + getNodeSize(child), 0);
        const pixelToSizeRatio = totalChildrenSize / nodePixels;

        let lastChildRect: Dimensions;
        const resizeHandles: ResizeHandleProps[] = [];
        node.children.forEach((child, i) => {
            const childSize = getNodeSize(child);
            const rect: Dimensions = {
                top: !nodeIsRow && lastChildRect ? lastChildRect.top + lastChildRect.height : nodeRect.top,
                left: nodeIsRow && lastChildRect ? lastChildRect.left + lastChildRect.width : nodeRect.left,
                width: nodeIsRow ? childSize / pixelToSizeRatio : nodeRect.width,
                height: nodeIsRow ? nodeRect.height : childSize / pixelToSizeRatio,
            };
            const transform = setTransform(rect);
            additionalPropsMap[child.id] = {
                rect,
                transform,
                treeKey: additionalProps.treeKey + i,
            };

            // We only want the resize handles in between nodes, this ensures we have n-1 handles.
            if (lastChildRect) {
                const resizeHandleIndex = resizeHandles.length;
                const halfResizeHandleSizePx = resizeHandleSizePx / 2;
                const resizeHandleDimensions: Dimensions = {
                    top: nodeIsRow
                        ? lastChildRect.top
                        : lastChildRect.top + lastChildRect.height - halfResizeHandleSizePx,
                    left: nodeIsRow
                        ? lastChildRect.left + lastChildRect.width - halfResizeHandleSizePx
                        : lastChildRect.left,
                    width: nodeIsRow ? resizeHandleSizePx : lastChildRect.width,
                    height: nodeIsRow ? lastChildRect.height : resizeHandleSizePx,
                };
                resizeHandles.push({
                    id: `${node.id}-${resizeHandleIndex}`,
                    parentNodeId: node.id,
                    parentIndex: resizeHandleIndex,
                    transform: setTransform(resizeHandleDimensions, true, false),
                    flexDirection: node.flexDirection,
                    centerPx:
                        (nodeIsRow ? resizeHandleDimensions.left : resizeHandleDimensions.top) + halfResizeHandleSizePx,
                });
            }
            lastChildRect = rect;
        });

        additionalPropsMap[node.id] = {
            ...additionalProps,
            ...(node.data?.blockId ? { rect: nodeRect } : {}),
            pixelToSizeRatio,
            resizeHandles,
        };
    }

    /**
     * Gets normalized dimensions for the TileLayout container.
     * @returns The normalized dimensions for the TileLayout container.
     */
    getBoundingRect: () => Dimensions = () => {
        const boundingRect = this.displayContainerRef.current.getBoundingClientRect();
        return { top: 0, left: 0, width: boundingRect.width, height: boundingRect.height };
    };

    /**
     * The dimensions of the TileLayout container, for code that may run while it is not on screen.
     */
    private getContainerRect(): Dimensions {
        const boundingRect = this.displayContainerRef.current?.getBoundingClientRect();
        if (boundingRect == null || boundingRect.width < 1 || boundingRect.height < 1) {
            return NominalContainerRect;
        }
        return { top: 0, left: 0, width: boundingRect.width, height: boundingRect.height };
    }

    private hasTileRect(): boolean {
        return !isFullRect(this.treeState.tileRect);
    }

    /**
     * The area the tiles fill, in CSS pixels.
     * @param container The dimensions of the TileLayout container.
     */
    private getTileRectPx(container: Dimensions): Dimensions {
        const pending = this.boxDrag?.pending.get(TilesBoxId);
        if (pending != null) {
            return pending;
        }
        if (!this.hasTileRect()) {
            return container;
        }
        return toPixels(this.treeState.tileRect, container);
    }

    private getMagnifiedTransform(boundingRect: Dimensions, magnifiedNodeSizePct: number): CSSProperties {
        const magnifiedNodeMarginPct = (1 - magnifiedNodeSizePct) / 2;
        return setTransform(
            {
                top: boundingRect.height * magnifiedNodeMarginPct,
                left: boundingRect.width * magnifiedNodeMarginPct,
                width: boundingRect.width * magnifiedNodeSizePct,
                height: boundingRect.height * magnifiedNodeSizePct,
            },
            true,
            true,
            "var(--zindex-layout-magnified-node)"
        );
    }

    private getFloatingNode(nodeId: string): FloatingNode {
        return this.treeState.floatingNodes?.find((float) => float.node.id === nodeId);
    }

    /**
     * Whether the layout holds any block, tiled or floating.
     */
    private hasNodes(): boolean {
        return this.treeState.rootNode != null || (this.treeState.floatingNodes?.length ?? 0) > 0;
    }

    private countLeafs(): number {
        let count = this.treeState.floatingNodes?.length ?? 0;
        walkNodes(this.treeState.rootNode, (node) => {
            if (!node.children?.length) {
                count++;
            }
        });
        if (this.getter(this.ephemeralNode)) {
            count++;
        }
        return count;
    }

    /**
     * The boxes that can be moved or resized freely: the area the tiles fill, if there are tiles, and the floating
     * blocks.
     */
    private getBoxes(container: Dimensions): Box[] {
        const boxes: Box[] = [];
        if (this.treeState.rootNode != null) {
            boxes.push({ id: TilesBoxId, rect: this.getTileRectPx(container) });
        }
        for (const float of this.treeState.floatingNodes ?? []) {
            boxes.push({ id: float.node.id, rect: toPixels(float.rect, container) });
        }
        return boxes;
    }

    /**
     * Everything that takes up space in the container, in CSS pixels.
     */
    private getObstacles(): Dimensions[] {
        return this.getBoxes(this.getContainerRect()).map((box) => box.rect);
    }

    /**
     * Where a new floating block should open, in CSS pixels.
     */
    private placeFloatingRect(): Dimensions {
        const container = this.getContainerRect();
        const floatingNodes = this.treeState.floatingNodes ?? [];
        const lastRect = this.treeState.lastFloatRect;
        // The block that has the focus is most likely the terminal that asked for the new one, to be read beside it.
        const stackOn = floatingNodes.filter((float) => float.node.id !== this.treeState.focusedNodeId).at(-1);
        return placeNewFloat(
            container,
            this.getObstacles(),
            floatingNodes.map((float) => toPixels(float.rect, container)),
            lastRect != null ? toPixels(lastRect, container) : undefined,
            stackOn != null ? toPixels(stackOn.rect, container) : undefined
        );
    }

    /**
     * Adds a node to the layout as a floating block, on top of the others.
     * @param node The leaf to add.
     * @param rect Where to put it, in CSS pixels.
     * @param focused Whether it should take the focus.
     */
    private addFloatingNode(node: LayoutNode, rect: Dimensions, focused: boolean) {
        this.treeState.floatingNodes = [
            ...(this.treeState.floatingNodes ?? []),
            { node, rect: toFractions(rect, this.getContainerRect()) },
        ];
        if (focused) {
            this.treeState.focusedNodeId = node.id;
        }
    }

    /**
     * Puts a floating node on top of the others.
     * @returns Whether the order changed.
     */
    private raiseFloatingNode(nodeId: string): boolean {
        const floats = this.treeState.floatingNodes;
        const float = this.getFloatingNode(nodeId);
        if (!float || floats.at(-1) === float) {
            return false;
        }
        this.treeState.floatingNodes = [...floats.filter((f) => f !== float), float];
        return true;
    }

    /**
     * Takes a tile out of the tiled layout and lets it float where it was, or puts a floating block among the tiles.
     */
    toggleFloating(nodeId: string) {
        const float = this.getFloatingNode(nodeId);
        if (float) {
            this.treeState.floatingNodes = this.treeState.floatingNodes.filter((f) => f !== float);
            if (this.treeState.rootNode == null) {
                // the first tile stays where it was as a floating block, instead of spreading under the others
                this.treeState.tileRect = isFullRect(float.rect) ? undefined : float.rect;
            }
            insertNode(this.treeState, {
                type: LayoutTreeActionType.InsertNode,
                node: float.node,
                magnified: false,
                focused: true,
            });
            this.commitTreeState();
            return;
        }
        const node = findNode(this.treeState.rootNode, nodeId);
        if (!node || node.children) {
            return;
        }
        if (this.magnifiedNodeId === nodeId) {
            this.magnifyNodeToggle(nodeId, false);
        }
        const container = this.getContainerRect();
        const rect = this.getNodeRectById(nodeId) ?? this.getTileRectPx(container);
        deleteNode(this.treeState, { type: LayoutTreeActionType.DeleteNode, nodeId });
        if (this.treeState.rootNode == null) {
            this.treeState.tileRect = undefined;
        }
        this.addFloatingNode(node, rect, true);
        this.commitTreeState();
    }

    /**
     * Lets the tiles fill the whole container again.
     */
    resetTileRect() {
        if (!this.hasTileRect()) {
            return;
        }
        this.treeState.tileRect = undefined;
        this.commitTreeState();
    }

    /**
     * Begins moving or resizing a floating block, or resizing the area the tiles fill.
     * @param boxId The id of the floating node, or TilesBoxId.
     * @param mode Whether the box is moved as a whole or resized by the given edges.
     * @param edges The edges that follow the pointer when resizing.
     * @param x The X coordinate of the pointer where the drag began, in CSS pixels relative to the window.
     * @param y The Y coordinate of the pointer where the drag began, in CSS pixels relative to the window.
     */
    startBoxDrag(boxId: string, mode: "move" | "resize", edges: BoxEdges, x: number, y: number) {
        const containerElem = this.displayContainerRef.current;
        if (!containerElem) {
            return;
        }
        const clientRect = containerElem.getBoundingClientRect();
        const container = this.getContainerRect();
        const boxes = this.getBoxes(container);
        const box = boxes.find((b) => b.id === boxId);
        if (!box) {
            return;
        }
        if (boxId !== TilesBoxId) {
            // this also brings it to the front
            this.focusNode(boxId);
        }
        const others = boxes.filter((b) => b.id !== boxId);
        const linked = mode === "resize" ? findLinkedBoxes(box, edges, others) : [];
        const lineRects = others.filter((b) => !linked.some((link) => link.id === b.id)).map((b) => b.rect);
        if (boxId !== TilesBoxId) {
            // a floating block can also be lined up with single tiles, to cover one exactly
            const floatingIds = this.getter(this.floatingNodeIds);
            for (const leaf of this.getter(this.leafs)) {
                const leafRect = this.getNodeRectById(leaf.id);
                if (leafRect != null && !floatingIds.has(leaf.id)) {
                    lineRects.push(leafRect);
                }
            }
        }
        this.boxDrag = {
            boxId,
            mode,
            edges,
            startPointer: { x, y },
            startRect: box.rect,
            container,
            containerOrigin: { x: clientRect.left, y: clientRect.top },
            linked,
            lines: collectSnapLines(container, lineRects),
            obstacles: others.map((b) => b.rect),
            pending: new Map(),
        };
        this.setter(this.boxDragActive, true);
    }

    /**
     * Continues the drag begun with startBoxDrag.
     * @param x The X coordinate of the pointer, in CSS pixels relative to the window.
     * @param y The Y coordinate of the pointer, in CSS pixels relative to the window.
     */
    moveBoxDrag(x: number, y: number) {
        const drag = this.boxDrag;
        if (!drag) {
            return;
        }
        const dx = x - drag.startPointer.x;
        const dy = y - drag.startPointer.y;
        drag.pending.clear();
        if (drag.mode === "move") {
            const moved = { ...drag.startRect, left: drag.startRect.left + dx, top: drag.startRect.top + dy };
            drag.pending.set(drag.boxId, keepReachable(snapMove(moved, drag.lines), drag.container));
            drag.zone = zoneAtPoint({ x: x - drag.containerOrigin.x, y: y - drag.containerOrigin.y }, drag.container);
            this.setter(
                this.snapPreview,
                drag.zone != null ? zoneRect(drag.zone, drag.container, drag.obstacles) : null
            );
        } else {
            const limits = resizeLimits(drag.container, drag.linked);
            const resized = resizeBox(drag.startRect, drag.edges, dx, dy, drag.lines, limits);
            drag.pending.set(drag.boxId, resized);
            for (const link of drag.linked) {
                drag.pending.set(link.id, followResize(link, resized));
            }
        }
        this.updateTree(false);
    }

    /**
     * Ends the drag begun with startBoxDrag, and keeps what it did unless it was cancelled.
     */
    endBoxDrag(cancel = false) {
        const drag = this.boxDrag;
        if (!drag) {
            return;
        }
        this.boxDrag = undefined;
        this.setter(this.boxDragActive, false);
        this.setter(this.snapPreview, null);
        if (cancel) {
            this.updateTree(false);
            return;
        }
        if (drag.mode === "move" && drag.zone != null) {
            drag.pending.set(drag.boxId, zoneRect(drag.zone, drag.container, drag.obstacles));
        }
        for (const [boxId, rect] of drag.pending) {
            const fractions = toFractions(rect, drag.container);
            if (boxId === TilesBoxId) {
                this.treeState.tileRect = isFullRect(fractions) ? undefined : fractions;
                continue;
            }
            const float = this.getFloatingNode(boxId);
            if (float) {
                float.rect = fractions;
            }
        }
        this.commitTreeState();
    }

    /**
     * The id of the focused node in the layout.
     */
    get focusedNodeId(): string {
        return this.focusedNodeIdStack[0];
    }

    /**
     * Checks whether the focused node id has changed and, if so, whether to update the focused node stack. If the focused node was deleted, will pop the latest value from the stack.
     * @param leafOrder The new leaf order array to use when searching for stale nodes in the stack.
     */
    private validateFocusedNode(leafOrder: LeafOrderEntry[]) {
        // The last tile can be closed while floating blocks remain, and the tree does not clear the focus when its
        // root goes.
        const focusedNodeId = this.treeState.focusedNodeId;
        if (focusedNodeId != null && !leafOrder.some((leafEntry) => leafEntry.nodeid === focusedNodeId)) {
            this.treeState.focusedNodeId = undefined;
        }
        const nothingFocused = this.treeState.focusedNodeId == null && leafOrder.length > 0;
        if (this.treeState.focusedNodeId !== this.focusedNodeId || nothingFocused) {
            // Remove duplicates and stale entries from focus stack.
            const newFocusedNodeIdStack: string[] = [];
            for (const id of this.focusedNodeIdStack) {
                if (leafOrder.find((leafEntry) => leafEntry?.nodeid === id) && !newFocusedNodeIdStack.includes(id))
                    newFocusedNodeIdStack.push(id);
            }
            this.focusedNodeIdStack = newFocusedNodeIdStack;

            // Update the focused node and stack based on the changes in the tree state.
            if (!this.treeState.focusedNodeId) {
                if (this.focusedNodeIdStack.length > 0) {
                    this.treeState.focusedNodeId = this.focusedNodeIdStack.shift();
                } else if (leafOrder.length > 0) {
                    // If no nodes are in the stack, use the top left node in the layout.
                    this.treeState.focusedNodeId = leafOrder[0].nodeid;
                }
            }
            this.focusedNodeIdStack.unshift(this.treeState.focusedNodeId);
        }
    }

    /**
     * When a layout is modified and only one leaf is remaining, we need to make sure it is no longer magnified.
     * @param leafOrder The new leaf order array to use when validating the number of leafs remaining.
     * @param addlProps The new additional properties object for all leafs in the layout.
     */
    private validateMagnifiedNode(leafOrder: LeafOrderEntry[], addlProps: Record<string, LayoutNodeAdditionalProps>) {
        if (leafOrder.length == 1) {
            const lastLeafId = leafOrder[0].nodeid;
            this.treeState.magnifiedNodeId = undefined;
            this.magnifiedNodeId = undefined;

            // Unset the transform for the sole leaf, so that CSS sizes it to the container. Not when it has a
            // rectangle of its own to keep: a floating block, or a tile in an area that is not the whole container.
            if (this.getFloatingNode(lastLeafId) || this.hasTileRect() || this.boxDrag != null) {
                return;
            }
            if (lastLeafId in addlProps) addlProps[lastLeafId].transform = undefined;
        }
    }

    /**
     * Helper function for the placeholderTransform atom, which computes the new transform value when the pending action changes.
     * @param pendingAction The new pending action value.
     * @returns The computed placeholder transform.
     *
     * @see placeholderTransform the atom that invokes this function and persists the updated value.
     */
    private getPlaceholderTransform(pendingAction: LayoutTreeAction): CSSProperties {
        if (pendingAction) {
            switch (pendingAction.type) {
                case LayoutTreeActionType.Move: {
                    const action = pendingAction as LayoutTreeMoveNodeAction;
                    let parentId: string;
                    if (action.insertAtRoot) {
                        parentId = this.treeState.rootNode.id;
                    } else {
                        parentId = action.parentId;
                    }

                    const parentNode = findNode(this.treeState.rootNode, parentId);
                    if (action.index !== undefined && parentNode) {
                        const targetIndex = boundNumber(
                            action.index - 1,
                            0,
                            parentNode.children ? parentNode.children.length - 1 : 0
                        );
                        const targetNode = parentNode?.children?.at(targetIndex) ?? parentNode;
                        if (targetNode) {
                            const targetBoundingRect = this.getNodeRect(targetNode);

                            // Placeholder should be either half the height or half the width of the targetNode, depending on the flex direction of the targetNode's parent.
                            // Default to placing the placeholder in the first half of the target node.
                            const placeholderDimensions: Dimensions = {
                                height:
                                    parentNode.flexDirection === FlexDirection.Column
                                        ? targetBoundingRect.height / 2
                                        : targetBoundingRect.height,
                                width:
                                    parentNode.flexDirection === FlexDirection.Row
                                        ? targetBoundingRect.width / 2
                                        : targetBoundingRect.width,
                                top: targetBoundingRect.top,
                                left: targetBoundingRect.left,
                            };

                            if (action.index > targetIndex) {
                                if (action.index >= (parentNode.children?.length ?? 1)) {
                                    // If there are no more nodes after the specified index, place the placeholder in the second half of the target node (either right or bottom).
                                    placeholderDimensions.top +=
                                        parentNode.flexDirection === FlexDirection.Column &&
                                        targetBoundingRect.height / 2;
                                    placeholderDimensions.left +=
                                        parentNode.flexDirection === FlexDirection.Row && targetBoundingRect.width / 2;
                                } else {
                                    // Otherwise, place the placeholder between the target node (the one after which it will be inserted) and the next node
                                    placeholderDimensions.top +=
                                        parentNode.flexDirection === FlexDirection.Column &&
                                        (3 * targetBoundingRect.height) / 4;
                                    placeholderDimensions.left +=
                                        parentNode.flexDirection === FlexDirection.Row &&
                                        (3 * targetBoundingRect.width) / 4;
                                }
                            }

                            return setTransform(placeholderDimensions);
                        }
                    }
                    break;
                }
                case LayoutTreeActionType.Swap: {
                    const action = pendingAction as LayoutTreeSwapNodeAction;
                    const targetNodeId = action.node1Id;
                    const targetBoundingRect = this.getNodeRectById(targetNodeId);
                    const placeholderDimensions: Dimensions = {
                        top: targetBoundingRect.top,
                        left: targetBoundingRect.left,
                        height: targetBoundingRect.height,
                        width: targetBoundingRect.width,
                    };

                    return setTransform(placeholderDimensions);
                }
                default:
                    // No-op
                    break;
            }
        }
        return;
    }

    /**
     * Gets the node model for the given node.
     * @param node The node for which to retrieve the node model.
     * @returns The node model for the given node.
     */
    getNodeModel(node: LayoutNode): NodeModel {
        const nodeid = node.id;
        const blockId = node.data.blockId;
        const addlPropsAtom = this.getNodeAdditionalPropertiesAtom(nodeid);
        if (!this.nodeModels.has(nodeid)) {
            this.nodeModels.set(nodeid, {
                additionalProps: addlPropsAtom,
                innerRect: atom((get) => {
                    const addlProps = get(addlPropsAtom);
                    const numLeafs = get(this.numLeafs);
                    const gapSizePx = get(this.gapSizePx);
                    if (numLeafs > 1 && addlProps?.rect) {
                        return {
                            width: `${addlProps.transform.width} - ${gapSizePx}px`,
                            height: `${addlProps.transform.height} - ${gapSizePx}px`,
                        } as CSSProperties;
                    } else {
                        return null;
                    }
                }),
                nodeId: nodeid,
                blockId,
                blockNum: atom((get) => get(this.leafOrder).findIndex((leafEntry) => leafEntry.nodeid === nodeid) + 1),
                isFocused: atom((get) => {
                    const treeState = get(this.localTreeStateAtom);
                    return treeState.focusedNodeId === nodeid;
                }),
                numLeafs: this.numLeafs,
                isResizing: this.isResizing,
                isMagnified: atom((get) => {
                    const treeState = get(this.localTreeStateAtom);
                    return treeState.magnifiedNodeId === nodeid;
                }),
                anyMagnified: atom((get) => {
                    const treeState = get(this.localTreeStateAtom);
                    return treeState.magnifiedNodeId != null;
                }),
                isEphemeral: atom((get) => {
                    const ephemeralNode = get(this.ephemeralNode);
                    return ephemeralNode?.id === nodeid;
                }),
                isFloating: atom((get) => get(this.floatingNodeIds).has(nodeid)),
                addEphemeralNodeToLayout: () => this.addEphemeralNodeToLayout(),
                animationTimeS: this.animationTimeS,
                ready: this.ready,
                disablePointerEvents: this.disablePointerEvents,
                onClose: () => fireAndForget(() => this.closeNode(nodeid)), // no longer used (instead we use keymodel uxCloseBlock)
                toggleMagnify: () => this.magnifyNodeToggle(nodeid),
                toggleFloating: () => this.toggleFloating(nodeid),
                focusNode: () => this.focusNode(nodeid),
                dragHandleRef: createRef(),
                displayContainerRef: this.displayContainerRef,
            });
        }
        const nodeModel = this.nodeModels.get(nodeid);
        return nodeModel;
    }

    /**
     * Remove orphaned node models when their corresponding leaf is deleted.
     * @param leafOrder The new leaf order array to use when locating orphaned nodes.
     */
    private cleanupNodeModels(leafOrder: LeafOrderEntry[]) {
        const orphanedNodeModels = [...this.nodeModels.keys()].filter(
            (id) => !leafOrder.find((leafEntry) => leafEntry.nodeid == id)
        );
        for (const id of orphanedNodeModels) {
            this.nodeModels.delete(id);
        }
    }

    /**
     * Switch focus to the next node in the given direction in the layout.
     * @param direction The direction in which to switch focus.
     */
    switchNodeFocusInDirection(direction: NavigateDirection): NavigationResult {
        const curNodeId = this.focusedNodeId;

        // If no node is focused, set focus to the first leaf.
        if (!curNodeId) {
            this.focusNode(this.getter(this.leafOrder)[0].nodeid);
            return { success: true };
        }

        const offset = navigateDirectionToOffset(direction);
        const nodePositions: Map<string, Dimensions> = new Map();
        const addlProps = this.getter(this.additionalProps);
        // Where blocks overlap, the search below finds the first one in this list: the topmost floating block
        // first, and the tiles last.
        const floatingNodes = [...(this.treeState.floatingNodes ?? [])].reverse().map((float) => float.node);
        const leafs = [...floatingNodes, ...this.getter(this.leafs).filter((leaf) => !floatingNodes.includes(leaf))];
        for (const leaf of leafs) {
            const pos = addlProps[leaf.id]?.rect;
            if (pos) {
                nodePositions.set(leaf.id, pos);
            }
        }
        const curNodePos = nodePositions.get(curNodeId);
        if (!curNodePos) {
            return { success: false };
        }
        nodePositions.delete(curNodeId);
        const boundingRect = this.displayContainerRef?.current.getBoundingClientRect();
        if (!boundingRect) {
            return { success: false };
        }
        const maxX = boundingRect.left + boundingRect.width;
        const maxY = boundingRect.top + boundingRect.height;
        const moveAmount = 10;
        const curPoint = getCenter(curNodePos);

        function findNodeAtPoint(m: Map<string, Dimensions>, p: Point): string {
            for (const [blockId, dimension] of m.entries()) {
                if (
                    p.x >= dimension.left &&
                    p.x <= dimension.left + dimension.width &&
                    p.y >= dimension.top &&
                    p.y <= dimension.top + dimension.height
                ) {
                    return blockId;
                }
            }
            return null;
        }

        while (true) {
            curPoint.x += offset.x * moveAmount;
            curPoint.y += offset.y * moveAmount;
            if (curPoint.x < 0 || curPoint.x > maxX || curPoint.y < 0 || curPoint.y > maxY) {
                // Determine which boundary was hit
                const result: NavigationResult = { success: false };
                if (curPoint.x < 0) {
                    result.atLeft = true;
                }
                if (curPoint.x > maxX) {
                    result.atRight = true;
                }
                if (curPoint.y < 0) {
                    result.atTop = true;
                }
                if (curPoint.y > maxY) {
                    result.atBottom = true;
                }
                return result;
            }
            const nodeId = findNodeAtPoint(nodePositions, curPoint);
            if (nodeId != null) {
                this.focusNode(nodeId);
                return { success: true };
            }
        }
    }

    /**
     * Switch focus to a node using the given BlockNum
     * @param newBlockNum The BlockNum of the node to which focus should switch.
     * @see leafOrder - the indices in this array determine BlockNum
     */
    switchNodeFocusByBlockNum(newBlockNum: number) {
        const leafOrder = this.getter(this.leafOrder);
        const newLeafIdx = newBlockNum - 1;
        if (newLeafIdx < 0 || newLeafIdx >= leafOrder.length) {
            return;
        }
        const leaf = leafOrder[newLeafIdx];
        this.focusNode(leaf.nodeid);
    }

    /**
     * Set the layout to focus on the given node.
     * @param nodeId The id of the node that is being focused.
     */
    focusNode(nodeId: string) {
        // a floating block that is given the focus comes to the front
        const raised = this.raiseFloatingNode(nodeId);
        if (this.focusedNodeId === nodeId) {
            if (raised) {
                this.commitTreeState();
            }
            return;
        }
        let layoutNode = findNode(this.treeState?.rootNode, nodeId) ?? this.getFloatingNode(nodeId)?.node;
        if (!layoutNode) {
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode?.id === nodeId) {
                layoutNode = ephemeralNode;
            } else {
                console.error("unable to focus node, cannot find it in tree", nodeId);
                return;
            }
        }
        const action: LayoutTreeFocusNodeAction = {
            type: LayoutTreeActionType.FocusNode,
            nodeId: nodeId,
        };

        this.treeReducer(action);
    }

    focusFirstNode() {
        const leafOrder = this.getter(this.leafOrder);
        if (leafOrder.length > 0) {
            this.focusNode(leafOrder[0].nodeid);
        }
    }

    getFirstBlockId(): string | undefined {
        const leafOrder = this.getter(this.leafOrder);
        if (leafOrder.length > 0) {
            return leafOrder[0].blockid;
        }
        return undefined;
    }

    /**
     * Toggle magnification of a given node.
     * @param nodeId The id of the node that is being magnified.
     */
    magnifyNodeToggle(nodeId: string, setState = true) {
        const action: LayoutTreeMagnifyNodeToggleAction = {
            type: LayoutTreeActionType.MagnifyNodeToggle,
            nodeId: nodeId,
        };

        // Unset the last ephemeral node id to ensure the magnify animation sits on top of the layout.
        this.lastEphemeralNodeId = undefined;

        this.treeReducer(action, setState);
    }

    /**
     * Close a given node and update the tree state.
     * @param nodeId The id of the node that is being closed.
     */
    async closeNode(nodeId: string) {
        const nodeToDelete = findNode(this.treeState.rootNode, nodeId) ?? this.getFloatingNode(nodeId)?.node;
        if (!nodeToDelete) {
            // TODO: clean up the ephemeral node handling
            // The ephemeral node is not in the tree, so we need to handle it separately.
            const ephemeralNode = this.getter(this.ephemeralNode);
            if (ephemeralNode?.id === nodeId) {
                this.setter(this.ephemeralNode, undefined);
                this.treeState.focusedNodeId = undefined;
                this.updateTree(false);
                this.setter(this.localTreeStateAtom, { ...this.treeState });
                this.persistToBackend();
                await this.onNodeDelete?.(ephemeralNode.data);
                return;
            }
            console.error("unable to close node, cannot find it in tree", nodeId);
            return;
        }
        if (nodeId === this.magnifiedNodeId) {
            this.magnifyNodeToggle(nodeId);
        }
        const deleteAction: LayoutTreeDeleteNodeAction = {
            type: LayoutTreeActionType.DeleteNode,
            nodeId: nodeId,
        };
        this.treeReducer(deleteAction);
        await this.onNodeDelete?.(nodeToDelete.data);
    }

    /**
     * Shorthand function for closing the focused node in a layout.
     */
    async closeFocusedNode() {
        await this.closeNode(this.focusedNodeId);
    }

    newEphemeralNode(blockId: string) {
        if (this.getter(this.ephemeralNode)) {
            this.closeNode(this.getter(this.ephemeralNode).id);
        }

        const ephemeralNode = newLayoutNode(undefined, undefined, undefined, { blockId });
        this.setter(this.ephemeralNode, ephemeralNode);

        const addlProps = this.getter(this.additionalProps);
        const leafs = this.getter(this.leafs);
        const boundingRect = this.getBoundingRect();
        const magnifiedNodeSizePct = this.getter(this.magnifiedNodeSizeAtom);
        this.updateEphemeralNodeProps(ephemeralNode, addlProps, leafs, magnifiedNodeSizePct, boundingRect);
        this.setter(this.additionalProps, addlProps);
        this.focusNode(ephemeralNode.id);
    }

    addEphemeralNodeToLayout() {
        const ephemeralNode = this.getter(this.ephemeralNode);
        this.setter(this.ephemeralNode, undefined);
        if (this.magnifiedNodeId) {
            this.magnifyNodeToggle(this.magnifiedNodeId, false);
        }
        this.lastEphemeralNodeId = ephemeralNode.id;
        if (ephemeralNode) {
            const action: LayoutTreeInsertNodeAction = {
                type: LayoutTreeActionType.InsertNode,
                node: ephemeralNode,
                magnified: false,
                focused: false,
            };
            this.treeReducer(action);
        }
    }

    updateEphemeralNodeProps(
        node: LayoutNode,
        addlPropsMap: Record<string, LayoutNodeAdditionalProps>,
        leafs: LayoutNode[],
        magnifiedNodeSizePct: number,
        boundingRect: Dimensions
    ) {
        const ephemeralNodeSizePct = this.magnifiedNodeId
            ? magnifiedNodeSizePct * magnifiedNodeSizePct
            : magnifiedNodeSizePct;
        const ephemeralNodeMarginPct = (1 - ephemeralNodeSizePct) / 2;
        const transform = setTransform(
            {
                top: boundingRect.height * ephemeralNodeMarginPct,
                left: boundingRect.width * ephemeralNodeMarginPct,
                width: boundingRect.width * ephemeralNodeSizePct,
                height: boundingRect.height * ephemeralNodeSizePct,
            },
            true,
            true,
            "var(--zindex-layout-ephemeral-node)"
        );
        addlPropsMap[node.id] = { treeKey: "-1", transform };
        leafs.push(node);
    }

    /**
     * Callback that is invoked when a drag operation completes and the pending action should be committed.
     */
    onDrop() {
        if (this.getter(this.pendingTreeAction.currentValueAtom)) {
            this.treeReducer({
                type: LayoutTreeActionType.CommitPendingAction,
            });
        }
    }

    /**
     * Callback that is invoked when the TileLayout container is being resized.
     */
    onContainerResize = () => {
        this.updateTree();
        this.setter(this.isContainerResizing, true);
        this.stopContainerResizing();
    };

    /**
     * Deferred action to restore animations once the TileLayout container is no longer being resized.
     */
    stopContainerResizing = debounce(30, () => {
        this.setter(this.isContainerResizing, false);
    });

    /**
     * Callback to update pending node sizes when a resize handle is dragged.
     * @param resizeHandle The resize handle that is being dragged.
     * @param x The X coordinate of the pointer device, in CSS pixels.
     * @param y The Y coordinate of the pointer device, in CSS pixels.
     */
    onResizeMove(resizeHandle: ResizeHandleProps, x: number, y: number) {
        const parentIsRow = resizeHandle.flexDirection === FlexDirection.Row;

        // If the resize context is out of date, update it and save it for future events.
        if (this.resizeContext?.handleId !== resizeHandle.id) {
            const parentNode = findNode(this.treeState.rootNode, resizeHandle.parentNodeId);
            const beforeNode = parentNode.children![resizeHandle.parentIndex];
            const afterNode = parentNode.children![resizeHandle.parentIndex + 1];

            const addlProps = this.getter(this.additionalProps);
            const pixelToSizeRatio = addlProps[resizeHandle.parentNodeId]?.pixelToSizeRatio;
            if (beforeNode && afterNode && pixelToSizeRatio) {
                this.resizeContext = {
                    handleId: resizeHandle.id,
                    displayContainerRect: this.displayContainerRef.current?.getBoundingClientRect(),
                    resizeHandleStartPx: resizeHandle.centerPx,
                    beforeNodeId: beforeNode.id,
                    afterNodeId: afterNode.id,
                    beforeNodeStartSize: beforeNode.size,
                    afterNodeStartSize: afterNode.size,
                    pixelToSizeRatio,
                };
            } else {
                console.error(
                    "Invalid resize handle, cannot get the additional properties for the nodes in the resize handle properties."
                );
                return;
            }
        }

        const clientPoint = parentIsRow
            ? x - this.resizeContext.displayContainerRect?.left
            : y - this.resizeContext.displayContainerRect?.top;
        const clientDiff = (this.resizeContext.resizeHandleStartPx - clientPoint) * this.resizeContext.pixelToSizeRatio;
        const minNodeSize = MinNodeSizePx * this.resizeContext.pixelToSizeRatio;
        const beforeNodeSize = this.resizeContext.beforeNodeStartSize - clientDiff;
        const afterNodeSize = this.resizeContext.afterNodeStartSize + clientDiff;

        // If either node will be too small after this resize, don't let it happen.
        if (beforeNodeSize < minNodeSize || afterNodeSize < minNodeSize) {
            return;
        }

        const resizeAction: LayoutTreeResizeNodeAction = {
            type: LayoutTreeActionType.ResizeNode,
            resizeOperations: [
                {
                    nodeId: this.resizeContext.beforeNodeId,
                    size: beforeNodeSize,
                },
                {
                    nodeId: this.resizeContext.afterNodeId,
                    size: afterNodeSize,
                },
            ],
        };
        const setPendingAction: LayoutTreeSetPendingAction = {
            type: LayoutTreeActionType.SetPendingAction,
            action: resizeAction,
        };

        this.treeReducer(setPendingAction);
        this.updateTree(false);
    }

    /**
     * Callback to end the current resize operation and commit its pending action.
     */
    onResizeEnd() {
        if (this.resizeContext) {
            this.resizeContext = undefined;
            this.treeReducer({ type: LayoutTreeActionType.CommitPendingAction });
        }
    }

    /**
     * Get the layout node matching the specified blockId.
     * @param blockId The blockId that the returned node should contain.
     * @returns The node containing the specified blockId, null if not found.
     */
    getNodeByBlockId(blockId: string): LayoutNode {
        for (const leaf of this.getter(this.leafs)) {
            if (leaf.data.blockId === blockId) {
                return leaf;
            }
        }
        return null;
    }

    /**
     * Get a jotai atom containing the additional properties associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the additional properties.
     * @returns An atom containing the additional properties associated with the given node.
     */
    getNodeAdditionalPropertiesAtom(nodeId: string): Atom<LayoutNodeAdditionalProps> {
        return atom((get) => {
            const addlProps = get(this.additionalProps);
            if (nodeId in addlProps) return addlProps[nodeId];
        });
    }

    /**
     * Get additional properties associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the additional properties.
     * @returns The additional properties associated with the given node.
     */
    getNodeAdditionalPropertiesById(nodeId: string): LayoutNodeAdditionalProps {
        const addlProps = this.getter(this.additionalProps);
        if (nodeId in addlProps) return addlProps[nodeId];
    }

    /**
     * Get additional properties associated with a given node.
     * @param node The node for which to retrieve the additional properties.
     * @returns The additional properties associated with the given node.
     */
    getNodeAdditionalProperties(node: LayoutNode): LayoutNodeAdditionalProps {
        return this.getNodeAdditionalPropertiesById(node.id);
    }

    /**
     * Get the CSS transform associated with a given node.
     * @param nodeId The ID of the node for which to retrieve the CSS transform.
     * @returns The CSS transform associated with the given node.
     */
    getNodeTransformById(nodeId: string): CSSProperties {
        return this.getNodeAdditionalPropertiesById(nodeId)?.transform;
    }

    /**
     * Get the CSS transform associated with a given node.
     * @param node The node for which to retrieve the CSS transform.
     * @returns The CSS transform associated with the given node.
     */
    getNodeTransform(node: LayoutNode): CSSProperties {
        return this.getNodeTransformById(node.id);
    }

    /**
     * Get the computed dimensions in CSS pixels of a given node.
     * @param nodeId The ID of the node for which to retrieve the computed dimensions.
     * @returns The computed dimensions of the given node, in CSS pixels.
     */
    getNodeRectById(nodeId: string): Dimensions {
        return this.getNodeAdditionalPropertiesById(nodeId)?.rect;
    }

    /**
     * Get the computed dimensions in CSS pixels of a given node.
     * @param node The node for which to retrieve the computed dimensions.
     * @returns The computed dimensions of the given node, in CSS pixels.
     */
    getNodeRect(node: LayoutNode): Dimensions {
        return this.getNodeRectById(node.id);
    }
}

function getLeafOrder(
    leafs: LayoutNode[],
    additionalProps: Record<string, LayoutNodeAdditionalProps>
): LeafOrderEntry[] {
    return leafs
        .map((node) => ({ nodeid: node.id, blockid: node.data.blockId }) as LeafOrderEntry)
        .sort((a, b) => {
            const treeKeyA = additionalProps[a.nodeid]?.treeKey;
            const treeKeyB = additionalProps[b.nodeid]?.treeKey;
            if (!treeKeyA || !treeKeyB) return;
            return treeKeyA.localeCompare(treeKeyB);
        });
}
