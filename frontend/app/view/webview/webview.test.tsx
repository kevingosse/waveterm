// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it } from "vitest";
import { atom, PrimitiveAtom } from "jotai";
import { WebViewModel } from "./webview";

function makeTestEnv(block: Block, settings: SettingsType) {
    const blockAtom = atom(block) as PrimitiveAtom<Block>;
    const settingsAtom = atom(settings) as PrimitiveAtom<SettingsType>;
    const env = {
        wos: { getWaveObjectAtom: () => blockAtom },
        getSettingsKeyAtom: (key: keyof SettingsType) => atom((get) => get(settingsAtom)[key]),
        getBlockMetaKeyAtom: (_blockId: string, key: keyof MetaType) => atom((get) => get(blockAtom)?.meta?.[key]),
        rpc: {
            SetMetaCommand: async (_client: unknown, data: CommandSetMetaData) => {
                const cur = globalStore.get(blockAtom);
                const meta: MetaType = { ...cur.meta, ...data.meta };
                for (const [key, val] of Object.entries(data.meta)) {
                    if (val == null) {
                        delete meta[key];
                    }
                }
                globalStore.set(blockAtom, { ...cur, meta });
            },
            SetConfigCommand: async (_client: unknown, data: SettingsType) => {
                globalStore.set(settingsAtom, { ...globalStore.get(settingsAtom), ...data });
            },
        },
    };
    return { env, blockAtom, settingsAtom };
}

describe("webview model", () => {
    it("uses the supplied env for homepage atoms and config updates", async () => {
        const blockId = "webview-env-block";
        const { env, blockAtom, settingsAtom } = makeTestEnv(
            { otype: "block", oid: blockId, version: 1, meta: { pinnedurl: "https://block.example" } } as Block,
            { "web:defaulturl": "https://default.example" }
        );
        const model = new WebViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(true),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env as any,
        });

        expect(globalStore.get(model.homepageUrl)).toBe("https://block.example");

        await model.setHomepageUrl("https://global.example", "global");

        expect(globalStore.get(model.homepageUrl)).toBe("https://global.example");
        expect(globalStore.get(settingsAtom)["web:defaulturl"]).toBe("https://global.example");
        expect(globalStore.get(blockAtom)?.meta?.pinnedurl).toBeUndefined();
    });
});
