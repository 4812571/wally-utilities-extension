/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";

import { Octokit } from "@octokit/rest";





const GITHUB_BASE_URL = "https://github.com/";

const USER_REPO_REGEX = new RegExp("([a-zA-Z\-]+)\/([a-zA-Z\-]+)");





type WallyGithubRegistryTree = {
	authors: Array<{
		name: string,
		sha: string,
	}>,
	config: {
		name: string,
		sha: string,
	},
};

type WallyGithubRegistryConfig = {
	api: string,
	github_oauth_id: string,
	fallback_registries?: string[],
};

export class WallyGithubHelper {
	private registryUser: string | null;
	private registryRepo: string | null;
	
	private tree: WallyGithubRegistryTree | null;
	private config: WallyGithubRegistryConfig | null;
	private nameCache: Map<string, string[]>;
	
	private log: vscode.OutputChannel;
	private kit: Octokit;
	
	constructor(logChannel: vscode.OutputChannel) {
		this.registryUser = null;
		this.registryRepo = null;
		this.tree = null;
		this.config = null;
		this.nameCache = new Map();
		this.log = logChannel;
		this.kit = new Octokit();
	}
	
	private logPlaintext(txt: string) {
		// TODO: Check if logging setting is on
		this.log.appendLine(`// ${txt}`);
	}
	
	private logJson(json: any) {
		// TODO: Check if logging setting is on
		this.log.appendLine(JSON.stringify(json, undefined, 4));
	}
	
	private async getRegistryTree(): Promise<WallyGithubRegistryTree | null> {
		if (this.registryUser && this.registryRepo) {
			// Check for cached tree
			if (this.tree) {
				return this.tree;
			}
			// Fetch tree from github
			this.logPlaintext("Fetching registry tree...");
			const treeResponse = await this.kit.git.getTree({
				owner: this.registryUser,
				repo: this.registryRepo,
				tree_sha: "main",
			});
			if (treeResponse.status === 200) {
				// Create new tree info
				const tree = {
					authors: new Array<{
						name: string,
						sha: string,
					}>,
					config: {
						name: "",
						sha: "",
					}
				};
				// Fill with authors & config file
				for (const item of treeResponse.data.tree) {
					if (
						typeof item.path === "string" &&
						typeof item.sha === "string"
					) {
						if (item.type === "tree") {
							tree.authors.push({
								name: item.path,
								sha: item.sha,
							});
						} else if (item.path.endsWith(".json")) {
							tree.config.name = item.path;
							tree.config.sha = item.sha;
						}
					}
				}
				// Set cache & return new tree
				this.tree = tree;
				return tree;
			}
			this.logPlaintext("Failed to fetch registry tree");
		}
		return null;
	}
	
	private async getRegistryConfig(): Promise<WallyGithubRegistryConfig | null> {
		const tree = await this.getRegistryTree();
		if (tree && this.registryUser && this.registryRepo) {
			// Check for cached config
			if (this.config) {
				return this.config;
			}
			// Fetch config contents blob from tree
			this.logPlaintext("Fetching registry config...");
			const fileResponse = await this.kit.git.getBlob({
				owner: this.registryUser,
				repo: this.registryRepo,
				file_sha: tree.config.sha,
			});
			if (fileResponse.status === 200) {
				const contents = Buffer.from(fileResponse.data.content, "base64");
				const config = JSON.parse(contents.toString());
				this.config = config;
				this.logJson(config);
				return config;
			}
		}
		return null;
	}
	
	private refreshRegistry() {
		this.tree = null;
		this.config = null;
		this.nameCache = new Map();
		this.getRegistryConfig();
	}
	
	setAuthToken(token: string | null) {
		this.kit = new Octokit({
			auth: token,
		});
		this.refreshRegistry();
	}
	
	getRegistry(): string | null {
		if (this.registryUser && this.registryRepo) {
			return `${this.registryUser}/${this.registryRepo}`;
		}
		return null;
	}
	
	setRegistry(registry: string, force?: boolean) {
		if (registry.startsWith(GITHUB_BASE_URL)) {
			// Check if the registry is the same as the current one, if
			// it is then we can skip setting it again, unless forced to
			const stripped = registry.slice(GITHUB_BASE_URL.length);
			if (stripped === this.getRegistry() && !force) {
				return;
			}
			const matches = USER_REPO_REGEX.exec(stripped);
			if (matches) {
				this.registryUser = matches[1];
				this.registryRepo = matches[2];
				this.refreshRegistry();
			} else {
				throw new Error(`Invalid registry: ${registry}`);
			}
		} else {
			throw new Error(`Unsupported registry: ${registry}`);
		}
	}
	
	async getAuthorNames(): Promise<string[] | null> {
		const tree = await this.getRegistryTree();
		if (tree) {
			const authorNames: string[] = [];
			for (const author of tree.authors) {
				authorNames.push(author.name);
			}
			return authorNames;
		}
		return null;
	}
	
	async getPackageNames(author: string): Promise<string[] | null> {
		// Check for cached names
		const cached = this.nameCache.get(author);
		if (cached) {
			return cached;
		}
		// Nothing cached, perform the request
		const tree = await this.getRegistryTree();
		if (tree && this.registryUser && this.registryRepo) {
			// Find author ref from authors list
			let authorSHA: string = "";
			const lowered = author.toLowerCase();
			for (const author of tree.authors) {
				if (author.name === lowered) {
					authorSHA = author.sha;
					break;
				}
			}
			if (authorSHA.length > 0) {
				// Fetch package names
				this.logPlaintext(`Fetching package names for '${lowered}'...`);
				const treeResponse = await this.kit.git.getTree({
					owner: this.registryUser,
					repo: this.registryRepo,
					tree_sha: authorSHA,
				});
				if (treeResponse.status === 200) {
					const packageNames: string[] = [];
					for (const item of treeResponse.data.tree) {
						if (item.path && item.type !== "tree") {
							if (item.path !== "owners.json") {
								packageNames.push(item.path);
							}
						}
					}
					this.nameCache.set(author, packageNames);
					return packageNames;
				}
			}
		}
		return null;
	}
	
	async getRegistryApiUrl(): Promise<string | null> {
		const config = await this.getRegistryConfig();
		if (config) {
			return config.api;
		}
		return null;
	}
}