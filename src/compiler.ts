import { camelCase, upperCaseFirst } from 'change-case';
import * as decode from 'decode-html';
import { concat, pull } from 'lodash';
import { Param, Widget } from './models/flutter-model';
import { Element, Tag, Text } from './models/html-model';
import { Options } from './watcher';

/**
 * Extracts from the html any import elements, and returns those elements as imports
 * @param html the html elements, which get modified
 * @returns a list of import urls
 */
export function extractImports(html: Element[]): string[] {
	const imports: Tag[] = []
	for (const el of html) {
		if (el.type == 'tag') {
			const tag = el as Tag
			if (tag.name == 'import') {
				imports.push(tag)
			}
		}
	}
	for (let tag of imports) {
		pull(html, tag)
	}
	const packageImports = imports
		.map(i => i.attribs['package'])
		.filter(i => !!i)
		.map(i => `package:${i}`)
	const fileImports = imports
		.map(i => i.attribs['file'])
		.filter(i => !!i)
	return concat(packageImports, fileImports)
}

/**
 * Compiles a parsed html tree into Flutter Dart code
 * @param html parsed html elements
 * @param options compilation options
 * @returns generated Dart widget tree
 */
export function compile(html: Element[], options: Options): Widget[] {
	return html
		// .filter(el=>isFlutterView(el))
		.map(el => compileTag(el as Tag, options))
}

/**
 * Converts a tag and all of its children into a flutter dart tree
 * @param tag the tag and children to convert
 * @param options compilation options
 * @returns widget descriptor with tree of connected children widgets
 */
function compileTag(tag: Tag, options: Options): Widget {
	// use the configured class name if we set it in the tagClasses option
	const originalName = tag.name
	for (let tagName of Object.keys(options.tagClasses)) {
		if (tag.name == tagName) tag.name = options.tagClasses[tagName]
	}

	// start building a widget with params
	const widgetClass = upperCaseFirst(camelCase(tag.name))
	const params: Param[] = []
	let generics: string[]
	let pugLine: number
	let pugColumn: number

	// process the tag attributes, transforming them into widget params
	if (tag.attribs) {
		for (const attr in tag.attribs) {
			let type: 'expression' | 'literal' | 'closure'
			let name: string
			if (attr.startsWith(':')) {
				type = 'expression'
				name = attr.substring(1)
			} else if (attr.startsWith('@')) {
				type = 'closure'
				name = attr.substring(1)
			} else {
				type = 'literal'
				name = attr
			}
			let value: string | undefined = tag.attribs[attr]
			if (value && value.startsWith(':')) {
				type = 'expression'
				value = value.substring(1)
			}
			switch (attr) {
				case 'pug-line': {
					const tagValue: string = tag.attribs[attr]
					const parts = tagValue.split(',')
					pugLine = parseInt(parts[0])
					pugColumn = parseInt(parts[1])
					break
				}
				case 'type': {
					generics = value
						.split(',')
						.map(param => param.trim())
					break
				}
				default: {
					const resolved = name.startsWith('^')
					params.push({
						class: 'param',
						type: type,
						name: (name == 'value' && !resolved) ? undefined : camelCase(name),
						originalName: name,
						value: attr != value ? decode(value) : true, // pug renders empty attributes as key==value
						resolved: resolved
					})
				}
			}
		}
	}

	// process the tag children, transforming them into a widget param named 'children'
	if (tag.children) {

		const children: Widget[] = []

		for (const child of tag.children) {
			switch (child.type) {
				case 'tag': {
					const subTag = child as Tag
					const widget = compileTag(subTag, options)
					children.push(widget)
					break
				}
				case 'text': {
					const text = child as Text
					const values = text.data.split('\n').map(line => line.trim())
					for (let value of values) {
						if (value.length !== 0 && !value.startsWith('//')) {
							const makeConst = options.autoConstText && value.indexOf('$') == -1
							const widget: Widget = {
								class: 'widget',
								name: options.tagClasses['text'],
								originalName: 'text',
								constant: makeConst,
								params: [
									{
										class: 'param',
										type: 'literal',
										value: decode(value),
										resolved: true
									}
								]
							}
							children.push(widget)
						}
					}
				}
			}
		}
		// always add children as the children property
		if (children.length > 0) {
			params.push({
				class: 'param',
				type: 'widgets',
				name: 'children',
				value: children,
				resolved: true
			})
		}
	}

	// create the widget for the tag using the name and parameters
	const isConstant = tag.attribs && (tag.attribs['const'] || tag.attribs['const'] == '')
	return {
		class: 'widget',
		constant: isConstant,
		name: widgetClass,
		originalName,
		generics,
		params,
		pugLine,
		pugColumn
	}
}
