// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import Logo from "@/app/asset/logo.svg";
import { atoms } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { isDev } from "@/util/isdev";
import { useAtomValue } from "jotai";
import { Modal } from "./modal";

interface AboutModalVProps {
    versionString: string;
    onClose: () => void;
}

const AboutModalV = ({ versionString, onClose }: AboutModalVProps) => {
    return (
        <Modal className="pt-[34px] pb-[34px] overflow-hidden w-[450px]" onClose={onClose}>
            <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
            <div className="flex flex-col gap-[26px] w-full relative z-10">
                <div className="flex flex-col items-center justify-center gap-4 self-stretch w-full text-center">
                    <Logo />
                    <div className="text-[25px]">Wavelet</div>
                    <div className="leading-5">
                        An unofficial fork of Wave Terminal
                        <br />
                        Not affiliated with or endorsed by Command Line Inc.
                    </div>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">Client Version {versionString}</div>
                <div className="grid grid-cols-2 gap-[10px] self-stretch w-full">
                    <a
                        href="https://github.com/wavetermdev/waveterm"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-brands fa-github mr-2"></i>Wave Terminal
                    </a>
                    <a
                        href="https://github.com/wavetermdev/waveterm/blob/main/ACKNOWLEDGEMENTS.md"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-book mr-2"></i>Open Source
                    </a>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                    Wave Terminal &copy; Command Line Inc.
                    <br />
                    Licensed under the Apache License 2.0
                </div>
            </div>
        </Modal>
    );
};

AboutModalV.displayName = "AboutModalV";

const AboutModal = () => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const versionString = `${fullConfig?.version ?? ""} (${isDev() ? "dev-" : ""}${fullConfig?.buildtime ?? ""})`;

    return <AboutModalV versionString={versionString} onClose={() => modalsModel.popModal()} />;
};

AboutModal.displayName = "AboutModal";

export { AboutModal, AboutModalV };
