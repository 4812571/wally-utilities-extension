import * as vscode from "vscode";

import { capitalCase as makeCapitalCase } from "change-case";

import { PUBLIC_REGISTRY_URL } from "../utils/constants";

import { getGlobalLog, WallyLogHelper } from "../utils/logger";

import { matchAuthorAndPackage } from "../utils/matching";

import { isWallyManifest, WallyGithubRegistryPackageVersion } from "../wally/base";

import { findDependencyAtPosition } from "../wally/misc";

import { parseWallyManifest, WallyManifestDependency } from "../wally/manifest";

import { getRegistryHelper, WallyRegistryHelper } from "../wally/registry";






export const WALLY_HOVER_SELECTOR = {
	language: "toml",
	scheme: "file"
};





const parseAuthorName = (author: string) => {
	const bracketStartIdx = author.indexOf("<");
	const parensStartIdx = author.indexOf("(");
	const detailStartIdx = Math.min(
		bracketStartIdx >= 0 ? bracketStartIdx : author.length,
		parensStartIdx >= 0 ? parensStartIdx : author.length
	);
	return author.slice(0, detailStartIdx).trim();
};

const createDependencyHoverMarkdown = (info: WallyGithubRegistryPackageVersion) => {
	const mkdown = new vscode.MarkdownString();
	mkdown.isTrusted = true;
	mkdown.supportHtml = true;
	mkdown.supportThemeIcons = true;
	// Extract package author & name
	let packageAuthor = "";
	let packageName = info.package.name;
	const matched = matchAuthorAndPackage(info.package.name);
	if (matched) {
		const [author, name] = matched;
		packageAuthor = author;
		packageName = name;
	}
	// If the package contains explicit authors, format the names of
	// them in a string such as "name, othername, thirdname and fourthname"
	// Also add in the package author from the package name as a detail after,
	// making the full string be in the format "Author Name (package-author)"
	const authors = info.package.authors;
	if (authors && authors.length > 0) {
		if (authors.length === 1) {
			const parsed = parseAuthorName(authors[0]);
			if (parsed.toLowerCase() !== packageAuthor) {
				packageAuthor = `${parsed} (${packageAuthor})`;
			} else {
				packageAuthor = parsed;
			}
		} else {
			const allButLast = authors.slice(0, authors.length - 1).map(author => parseAuthorName(author));
			packageAuthor = `${allButLast.join(", ")} and ${parseAuthorName(authors[authors.length - 1])} (${packageAuthor})`;
		}
	}
	// Package name
	mkdown.appendMarkdown(`<h2 style="display: inline;">$(package)  ${makeCapitalCase(packageName)}</h2>`);
	mkdown.appendMarkdown(`<h3 style="display: inline;">by ${packageAuthor}</h3>`);
	// Package description
	if (info.package.description) {
		mkdown.appendMarkdown(`<p>${info.package.description}</p>`);
	}
	// Link to package on wally.run, if the
	// package is from the public registry
	if (info.package.registry.toLowerCase() === PUBLIC_REGISTRY_URL) {
		const link = `https://wally.run/package/${info.package.name}`;
		mkdown.appendMarkdown(`<p><a href = "${link}">$(link-external)  View on the official Wally registry</a></p>`);
	}
	return mkdown;
};





export class WallyHoverProvider implements vscode.HoverProvider {
	private log: WallyLogHelper;
	
	private enabled: boolean;
	
	constructor() {
		this.log = getGlobalLog();
		this.enabled = true;
	}
	
	async provideDependencyHover(registry: WallyRegistryHelper, dependency: WallyManifestDependency) {
		if (
			dependency.hasFullAuthor
			&& dependency.hasFullName
			&& dependency.version.length >= 0
		) {
			const latestCompatible = await registry.getLatestSemverCompatibleVersion(
				dependency.author,
				dependency.name,
				dependency.fullVersion
			);
			if (latestCompatible) {
				const latestInfo = await registry.getFullPackageInfo(
					dependency.author,
					dependency.name,
					dependency.fullVersion
				);
				if (latestInfo) {
					return new vscode.Hover(
						createDependencyHoverMarkdown(latestInfo),
						new vscode.Range(
							dependency.start,
							dependency.end
						)
					);
				}
			}
		}
		return null;
	}
	
	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
		// Make sure completion is enabled
		if (!this.enabled) {
			this.log.verboseText("Hover is not enabled");
			return null;
		}
		// Check if this toml file is a wally manifest
		if (isWallyManifest(document)) {
			// Try to parse this wally manifest file
			const manifest = parseWallyManifest(document);
			if (manifest) {
				// Look for what dependency our cursor is currently inside
				const found = findDependencyAtPosition(manifest, position);
				// Provide hover for the found dependency
				if (found) {
					const [_, dependency] = found;
					const registryUrl = manifest.package.registry.cleanedText;
					const registry = getRegistryHelper(registryUrl);
					return await this.provideDependencyHover(registry, dependency);
				}
			} else {
				this.log.normalText("Manifest could not be parsed");
			}
		}
		return null;
	}
	
	setEnabled(enabled: boolean) {
		this.enabled = enabled;
	}
}