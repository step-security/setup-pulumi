import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as os from "os";
import * as io from '@actions/io';
import * as path from "path";
import { getVersionObject } from "./lib/get-version";
import { verifyChecksum } from "./lib/verify-checksum";
import {validateSubscription} from "./subscription";

async function run() {
    try {
        await validateSubscription();
        const platforms = {
            linux: 'linux-x64',
            darwin: 'darwin-x64',
            win32: 'windows-x64',
        };

        const runnerPlatform = os.platform();

        if (!(runnerPlatform in platforms)) {
          throw new Error(
            "Unsupported operating system - Pulumi CLI is only released for Darwin, Linux and Windows"
          );
        }

        const platform = platforms[runnerPlatform];

        const range = core.getInput("pulumi-version");
        core.info(`Configured range: ${range}`);
        const { version, downloads, checksums } = await getVersionObject(range);

        core.info(`Matched version: ${version}`);

        const destination = path.join(os.homedir(), ".pulumi");
        core.info(`Install destination is ${destination}`)

        await io
            .rmRF(path.join(destination, 'bin'))
            .catch()
            .then(() => {
                core.info(`Successfully deleted pre-existing ${path.join(destination, "bin")}`);
            })

        const downloaded = await tc.downloadTool(downloads[platform]);
        core.debug(`successfully downloaded ${downloads[platform]}`);

        const verification = await verifyChecksum(downloaded, downloads[platform], checksums);
        if (verification === 'verified') {
            core.info(`Verified SHA-256 checksum of ${downloads[platform]}`);
        } else {
            core.warning(`No checksum file published for ${version}; skipping integrity verification`);
        }


        // The packages for Windows and *nix are structured differently - note the extraction paths for each.
        switch (platform) {
            case "windows":
                await tc.extractZip(downloaded, os.homedir());
                await io.mv(path.join(os.homedir(), 'Pulumi'), path.join(os.homedir(), '.pulumi'));
                break;
            default:
                const destinationPath = await io.mkdirP(destination);
                core.info(`Successfully created ${destinationPath}`)
                const extractedPath = await tc.extractTar(downloaded, destination);
                core.info(`Successfully extracted ${downloaded} to ${extractedPath}`)
                const oldPath = path.join(destination, 'pulumi')
                const newPath = path.join(destination, 'bin')
                await io.mv(oldPath, newPath);
                core.info(`Successfully renamed ${oldPath} to ${newPath}`)
                break;
        }

        const cachedPath = await tc.cacheDir(path.join(destination, 'bin'), 'pulumi', version);
        core.addPath(cachedPath);

    } catch (error) {
        core.setFailed(error instanceof Error ? error.message : String(error));
    }
}

run();
