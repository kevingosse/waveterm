// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

import { refocusNode } from "@/app/store/global";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { getDefaultTermBlockDef, listWidgetsForWorkspace } from "@/app/workspace/widgetfilter";
import { cn, fireAndForget, isBlank, makeIconClass } from "@/util/util";
import { autoUpdate, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";

export type NewBlockButtonEnv = WaveEnvSubset<{
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
    };
    createBlock: WaveEnv["createBlock"];
}>;

const WidgetsFileBlockDef: BlockDef = { meta: { view: "waveconfig", file: "widgets.json" } };
const SettingsBlockDef: BlockDef = { meta: { view: "waveconfig" } };

type MenuRowProps = {
    icon: string;
    color?: string;
    label: string;
    title?: string;
    onClick: () => void;
};

function MenuRow({ icon, color, label, title, onClick }: MenuRowProps) {
    return (
        <div
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded cursor-pointer text-secondary hover:bg-hoverbg hover:text-white"
            title={title}
            onClick={onClick}
        >
            <div className="flex justify-center w-5 text-[15px]" style={{ color }}>
                <i className={makeIconClass(icon, true, { defaultIcon: "browser" })} />
            </div>
            <div className="text-sm whitespace-nowrap">{label}</div>
        </div>
    );
}

// The widget bar folded into the title bar: one click for a terminal, the arrow for everything the bar offers.
// With the bar hidden this is the only way to the settings, which is why they are listed here too.
const NewBlockButton = memo(() => {
    const env = useWaveEnv<NewBlockButtonEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const [isOpen, setIsOpen] = useState(false);

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: (open, _event, reason) => {
            setIsOpen(open);
            // the click that opened the menu took the focus away from the block; without this, the next keys go nowhere
            if (!open && reason === "escape-key") {
                refocusNode(null);
            }
        },
        placement: "bottom-start",
        middleware: [offset(4), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const widgetsMap = fullConfig?.widgets;
    const widgets = listWidgetsForWorkspace(widgetsMap, workspaceId).filter((widget) => !widget["display:hidden"]);

    const open = (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => {
        setIsOpen(false);
        fireAndForget(() => env.createBlock(blockDef, magnified, ephemeral));
    };

    return (
        <>
            <div
                ref={refs.setReference}
                {...getReferenceProps()}
                className="flex h-[22px] mr-1.5 mb-1 rounded-md overflow-hidden bg-white/10 text-[12px] text-secondary"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
                <button
                    type="button"
                    title="New Terminal"
                    className="flex items-center pl-2.5 pr-2 cursor-pointer transition-colors hover:bg-white/10 hover:text-primary"
                    onClick={() => open(getDefaultTermBlockDef(widgetsMap))}
                >
                    <i className={makeIconClass("terminal", false)} />
                </button>
                <button
                    type="button"
                    title="New Block"
                    className={cn(
                        "flex items-center px-1.5 border-l border-white/10 cursor-pointer transition-colors hover:bg-white/10 hover:text-primary",
                        isOpen && "bg-white/10 text-primary"
                    )}
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <i className="fa fa-solid fa-chevron-down text-[9px]" />
                </button>
            </div>
            {isOpen && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        className="min-w-[180px] p-1 rounded-lg border border-border bg-modalbg shadow-xl z-50"
                    >
                        {widgets.map((widget, idx) => (
                            <MenuRow
                                key={idx}
                                icon={widget.icon}
                                color={widget.color}
                                label={isBlank(widget.label) ? widget.blockdef?.meta?.view : widget.label}
                                title={widget.description}
                                onClick={() => open(widget.blockdef, widget.magnified)}
                            />
                        ))}
                        <div className="h-px my-1 bg-border" />
                        <MenuRow
                            icon="pen-to-square"
                            label="Edit widgets.json"
                            onClick={() => open(WidgetsFileBlockDef, false, true)}
                        />
                        <MenuRow icon="gear" label="Settings" onClick={() => open(SettingsBlockDef, false, true)} />
                    </div>
                </FloatingPortal>
            )}
        </>
    );
});
NewBlockButton.displayName = "NewBlockButton";

export { NewBlockButton };
