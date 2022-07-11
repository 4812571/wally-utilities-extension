import * as vscode from "vscode";

import axios from "axios";

import { compare as compareSemver } from "semver";

import { WallyGithubHelper } from "./github";





type WallyApiPackageVersion = {
	package: {
		realm: string,
		version: string,
		registry: string,
	},
	["dependencies"]: {[author: string]: string},
	["server-dependencies"]: {[author: string]: string},
	["dev-dependencies"]: {[author: string]: string},
};






export class WallyRegistryHelper {
	private log: vscode.OutputChannel;
	private git: WallyGithubHelper;
	
	constructor(logChannel: vscode.OutputChannel, githubHelper: WallyGithubHelper) {
		this.log = logChannel;
		this.git = githubHelper;
	}
	
	private logPlaintext(txt: string) {
		// TODO: Check if logging setting is on
		this.log.appendLine(`// ${txt}`);
	}
	
	private logJson(json: any) {
		// TODO: Check if logging setting is on
		this.log.appendLine(JSON.stringify(json, undefined, 4));
	}
	
	getRegistry(): string | null {
		return this.git.getRegistry();
	}
	
	setRegistry(registry: string) {
		return this.git.setRegistry(registry);
	}
	
	async getPackageAuthors(): Promise<string[] | null> {
		return this.git.getAuthorNames();
	};
	
	async getPackageNames(author: string): Promise<string[] | null> {
		return this.git.getPackageNames(author);
	};
	
	async getPackageVersions(author: string, name: string): Promise<string[] | null> {
		// TODO: Cache package versions
		const url = await this.git.getRegistryApiUrl();
		if (url) {
			const fullUrl = `${url}/v1/package-metadata/${author}/${name}`;
			this.logPlaintext(`Looking for packages at ${fullUrl}`);
			const response = await axios({
				method: 'GET',
				url: fullUrl,
				responseType: 'json'
			});
			if (response.data && typeof response.data.versions === "object") {
				const versions: WallyApiPackageVersion[] = response.data.versions;
				const versionStrings = versions.map(ver =>  ver.package.version);
				return versionStrings.sort(compareSemver).reverse();
			}
		}
		return null; // Invalid author or something went wrong
	};
}