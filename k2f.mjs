//knitout to formal knitout

// add length annotations as implied
// use proper synonyms
// elaborate implied misses into explicit misses
// divide misses into single-needle steps
// divide racking into single-needle steps

import * as fs from 'fs';

if (process.argv.length != 4) {
	console.log("Usage:\n\tnode k2f.mjs <in.knitout> <out.fnitout>\nConvert knitout to formal knitout.");
	process.exit(1);
}

const infile = process.argv[2];
const outfile = process.argv[3];

console.log(`Will convert ${infile} (knitout) to ${outfile} (formal knitout).`);

const lines = fs.readFileSync(infile,{encoding:'utf8'}).split(/\r?\n/);

let lineIndex = 0;

function error(message) {
	console.error(`${infile}:${lineIndex+1}: ERROR: ${message}`);
	process.exit(1);
}

//(parsing based on knitout-to-dat.js)

//---- knitout magic number ----

{
	if (lineIndex >= lines.length) error(`No first line to check for magic number.`);
	let m = lines[lineIndex].match(/^;!knitout-(\d+)$/);
	if (!m) error(`invalid knitout magic string`);
	if (parseInt(m[1]) > 2) {
		console.warn("WARNING: File is version " + m[1] + ", but this code only knows about versions up to 2.");
	}
	++lineIndex;
}

let headers = {};

//read header lines at the start of the file:
for (; lineIndex < lines.length; ++lineIndex) {
	let line = lines[lineIndex];

	//comment headers must start with ';;':
	if (!line.startsWith(';;')) break;

	//comment headers must include the string ': ':
	let idx = line.indexOf(': ');
	if (idx === -1) {
		console.warn("Comment-header-like line '" + line + "' does not contain string ': ' -- interpreting as regular comment.");
		break;
	}
	let header = line.substr(2, idx-2);
	let value = line.substr(idx+2);

	if (header in headers) console.warn("WARNING: header '" + header + "' specified more than once. Will use last value.");
	if        (header === 'Carriers') {
		headers.Carriers = value.split(/[ ]+/); //this is slightly generous -- the spec says "space-separated" not "whitespace-separated"
	} else if (header === 'Gauge') {
		if (/^\d+\.?\d*$/.test(value) && parseFloat(value) > 0) {
			headers.Gauge = parseFloat(value);
		} else {
			throw "ERROR: Guage header's value ('" + value + "') should be a number greater than zero.";
		}
	} else if (header.startsWith('Yarn-')) {
		//ignore
	} else if (header === 'Machine') {
		//ignore
	} else if (header === 'Width') {
		//ignore
	} else if (header === 'Position') {
		//ignore
	} else {
		console.warn("WARNING: File contains unknown comment header '" + header + "'.");
	}
} //for (lines)

//'Carriers:' header is required
if (!('Carriers' in headers)) {
	error('Carriers header not included but is required.');
}

//Set default 'Gauge' if not specified + report current value:
if (!('Gauge' in headers)) {
	headers.Gauge = 15;
	console.log(`Gauge header not specified. Assuming needles are 1 / ${headers.Gauge} inches apart.`);
} else {
	console.log(`Gauge header indicates needles are 1 / ${headers.Gauge} inches apart.`);
}


//---- knitout instructions ----


let carriers = {};

//carriers is map from name => {
// yarn: N, //1-based yarn name
// if in:
//   attached:{direction:, bed:, needle:}, //loop this is attached to, used to reckon yarn length
//   parked:{direction:, bed:, needle:}, //loop this is parked at, used to emit misses
// else if pending:
//   pending:{line:}, //if hasn't been used yet
// 
//}


{ //assign all carriers positive integers:
	let prevYarn = 0;
	let remap = false;
	for (let name of headers.Carriers) {
		if (/^\d+$/.test(name) && parseInt(name) > prevYarn) {
			carriers[name] = {yarn:parseInt(name)};
			prevYarn = parseInt(name);
		} else {
			remap = true;
		}
	}
	if (remap) {
		console.log("Carrier names were not integers in order, so using positon-based remapping.");
		for (let i = 0; i < headers.Carriers.length; ++i) {
			carriers[name].yarn = i+1;
		}
	}
	let info = 'Carrier names map to yarn numbers as follows:';
	let expected = true;
	for (let name of headers.Carriers) {
		info += `\n  '${name}' -> ${carriers[name].yarn}`;
		if (name !== carriers[name].yarn.toString()) expected = false;
	}
	if (expected) {
		console.log(`Will use carrier names (${headers.Carriers.join(' ')}) directly as yarn numbers.`);
	} else {
		console.log(info);
	}
}

//will put fnitout program into output:
let output = [];

//track current racking to support incremental racking:
let racking = 0;

//track what is holding loops to decay knit/split -> tuck:
let loops = {};

for ( ; lineIndex < lines.length; ++lineIndex) {
	let original = lines[lineIndex];
	let line = original;
	let comment = '';

	//strip comments:
	let i = line.indexOf(';');
	if (i >= 0) {
		comment = line.substr(i);
		line = line.substr(0, i);
	}

	//tokenize:
	let tokens = line.split(/[ ]+/);

	//trim potentially empty first and last tokens:
	if (tokens.length > 0 && tokens[0] === "") tokens.shift();
	if (tokens.length > 0 && tokens[tokens.length-1] === "") tokens.pop();

	//skip empty lines:
	if (tokens.length === 0) {
		if (comment) emit('');
		continue;
	}

	let op = tokens.shift();
	let args = tokens;
	let expectNoCarriers = false;

	//Handle synonyms:
	if (op === 'amiss') {
		op = 'tuck';
		args.unshift('+');
		expectNoCarriers = true;
	} else if (op === 'drop') {
		op = 'knit';
		args.unshift('+');
		expectNoCarriers = true;
	} else if (op === 'xfer') {
		op = 'split';
		args.unshift('+');
		expectNoCarriers = true;
	}

	//helpers for operations:
	function parseNeedle(n) {
		const m = n.match(/^([fb]s?)(-?\d+)$/);
		if (!m) error(`invalid needle specification '${n}'`);
		return {bed:m[1], index:parseInt(m[2])};
	}

	function emit(op) {
		if (original != '') {
			while (op.length < 30) op += ' ';
			op += '; ' + original;
		}
		output.push(op);
		original = '';
	}

	//Handle operations:
	if (op === 'in' || op === 'inhook') {
		const cs = args;
		if (cs.length === 0) error("Can't bring in no carriers");

		for (const cn of cs) {
			if (!(cn in carriers)) error(`Carrier '${cn}' not named in Carriers comment header.`);
			if ('parked' in carriers[cn]) error(`Can't in '${cn}' -- it's already in.`);
			if ('pending' in carriers[cn]) error(`Can't in '${cn}' -- it's pending.`);
			
			carriers[cn].pending = {
				outputIndex:output.length,
				original:original
			};
			emit(`(PLACEHOLDER FOR ${cn} IN)`);
		}
	} else if (op === 'releasehook') {
		//ignore holding hook operations!
	} else if (op === 'out' || op === 'outhook') {
		const cs = args;
		if (cs.length === 0) error("Can't bring out no carriers");
		for (const cn of cs) {
			if (!(cn in carriers)) error(`Carrier '${cn}' not named in Carriers comment header.`);
			if ('parked' in carriers[cn]) {
				const a = carriers[cn].attached;
				emit(`out ${a.direction} ${a.bed}.${a.index + (a.direction === '+' ? 1 : -1)} ${carriers[cn].yarn}`);
				delete carriers[cn].parked;
				delete carriers[cn].attached;
			} else if ('pending' in carriers[cn]) {
				error(`Can't out '${cn}' -- it's pending, not in.`);
			} else {
				error(`Can't out '${cn}' -- it isn't in.`);
			}
		}
	} else if (op === 'rack') {
		if (args.length !== 1) error("racking takes one argument");
		if (!/^[+-]?\d*\.?\d+$/.test(args[0])) error("racking must be a number");
		let newRacking = parseFloat(args.shift());
		let frac = newRacking - Math.floor(newRacking);
		if (frac != 0) error("quarter-pitch racking conversion not supported yet");
		if (racking == newRacking) {
			emit(`; (rack not needed)`);
		} else {
			while (racking != newRacking) {
				if (racking < newRacking) racking += 1;
				else racking -= 1;
				emit(`rack ${racking}`);
			}
			//TODO: miss back-bed-attached carriers over(!)
		}
	} else if (op === 'stitch') {
		if (args.length !== 2) error("stitch takes two arguments.");
		if (!/^[+-]?\d+$/.test(args[0]) || !/^[+-]?\d+$/.test(args[1])) error("stitch arguments must be integers.");
		let newLeading = parseInt(args.shift());
		let newStitch = parseInt(args.shift());
		//TODO: maybe remember this for loop lengths?
	} else if (op === 'x-presser-mode') {
		//ignore
	} else if (op === 'x-speed-number') {
		//ignore
	} else if (op === 'x-stitch-number') {
		if (args.length !== 1) error("x-stitch-number takes one argument.");
		if (!/^[+]?\d+$/.test(args[0])) error("x-stitch-number argument must be non-negative integer.");
		let newStitchNumber = parseInt(args.shift());
		//TODO: maybe remember this for loop lengths?
	} else if (op === 'miss' || op === 'tuck' || op === 'knit' || op === 'split') {
		const d = args.shift();
		const n = parseNeedle(args.shift());
		const t = (op === 'split' ? parseNeedle(args.shift()) : null);
		const cs = args;

		if (!(n.bed === 'f' || n.bed === 'b')) error("sliders not supported yet by translation code");
		if (t && !(t.bed === 'f' || t.bed === 'b')) error("sliders not supported yet by translation code");

		if (expectNoCarriers && cs.length !== 0) error("cannot amiss/drop/xfer with carriers (use tuck/knit/split).");

		if (cs.length === 0 && op === 'miss') error("it makes no sense to miss with no yarns.");

		//set up carriers:
		for (const cn of cs) {
			if (!(cn in carriers)) error(`Carrier '${cn}' not named in Carriers comment header.`);
			const c = carriers[cn];
			let before = {bed:n.bed, index:n.index + (d === '+' ? -1 : 1), direction:d};
			if ('pending' in c) {
				//retroactively bring carrier in:
				// -- use front bed location to avoid back-bed location having different meaning in patched instruction
				output[c.pending.outputIndex] = `in ${before.direction} f.${before.index + (before.bed === 'b' ? racking : 0)} ${c.yarn} ;${c.pending.original}`;
				c.parked = before;
				c.attached = before;
				delete c.pending;
			} else if ('parked' in c) {
				//move carrier to just before needle:
				const target = before.index + (before.direction === '+' ? 0.5 : -0.5) + (before.bed === 'b' ? racking : 0);
				let wasLess = false;
				let wasMore = false;
				while (true) {
					const current = c.parked.index + (c.parked.direction === '+' ? 0.5 : -0.5) + (c.parked.bed === 'b' ? racking : 0);
					if (current === target) break;
					if (current < target) {
						console.assert(!wasMore); wasLess = true; //DEBUG: assert on infinite loop
						if (c.parked.direction === '-') c.parked.direction = '+';
						else c.parked.index += 1;
						emit(`miss + ${c.parked.bed}.${c.parked.index} ${c.yarn}`);
					} else if (current > target) {
						console.assert(!wasLess); wasMore = true; //DEBUG: detect infinite loop
						if (c.parked.direction === '+') c.parked.direction = '-';
						else c.parked.index -= 1;
						emit(`miss - ${c.parked.bed}.${c.parked.index} ${c.yarn}`);
					}
				}
			} else {
				error(`Carrier '${cn}' isn't pending or in.`);
			}
		}

		//operation name decay based on loop presence:
		if (op === 'knit' || op === 'split') {
			const key = `${n.bed}.${n.index}`;
			if (!(key in loops)) op = 'tuck';
		}

		let stitchSize = 30; //TODO: actually figure out how to set this (maybe using 'stitch'?)

		let yarns = [];
		for (const cn of cs) {
			const c = carriers[cn];
			const w = 0.0; //"needle width"
			const here = n.index + (n.bed === 'b' ? racking : 0) + (d === '+' ? -w : w);
			const attached = c.attached.index + (c.attached.bed === 'b' ? racking : 0) + (c.attached.direction === '+' ? w : -w);
			const yarnLength = Math.abs(here - attached);
			yarns.push(`(${c.yarn},${yarnLength})`);
		}

		//emit instruction:
		if (op === 'miss') {
			for (const cn of cs) {
				const c = carriers[cn];
				emit(`miss ${d} ${n.bed}.${n.index} ${c.yarn}`);
			}
		} else if (op === 'tuck') {
			if (cs.length === 0) {
				emit(`; amiss ignored`);
			} else {
				emit(`tuck ${d} ${n.bed}.${n.index} ${stitchSize} ${yarns.join(' ')}`);
				const key = `${n.bed}.${n.index}`;
				if (!(key in loops)) loops[key] = cs.length;
				else loops[key] += cs.length;
			}
		} else if (op === 'knit') {
			if (cs.length === 0) {
				emit(`drop ${n.bed}.${n.index}`);
				delete loops[`${n.bed}.${n.needle}`];
			} else {
				emit(`knit ${d} ${n.bed}.${n.index} ${stitchSize} ${yarns.join(' ')}`);
				loops[`${n.bed}.${n.needle}`] = cs.length;
			}
		} else if (op === 'split') {
			const keyN = `${n.bed}.${n.index}`;
			console.assert(keyN in loops, "should have decayed");
			if (cs.length === 0) {
				emit(`xfer ${n.bed}.${n.index} ${t.bed}.${t.index}`);
			} else {
				emit(`split ${d} ${n.bed}.${n.index} ${stitchSize} ${yarns.join(' ')}`);
			}
			const keyT = `${t.bed}.${t.index}`;
			if (!(keyT in loops)) loops[keyT] = loops[keyN];
			else loops[keyT] += loops[keyN];

			if (cs.length === 0) delete loops[keyN];
			else loops[keyN] = cs.length;

			//update carrier attachments & parkings:
			// (for *all* carriers -- though carriers in cs will get this info overwritten)
			for (const cn in carriers) {
				const c = carriers[cn];
				if (!('parked' in c)) continue;
				if (c.attached.bed === n.bed && c.attached.index === n.index) {
					c.attached.bed = t.bed;
					c.attached.index = t.index;
				}
				if (c.parked.bed === n.bed && c.parked.index === n.index) {
					c.parked.bed = t.bed;
					c.parked.index = t.index;
				}
			}

		} else {
			console.assert(false, `Operation ${op} should not be processed here.`);
		}

		//update carrier attachments + parkings:
		for (const cn of cs) {
			const c = carriers[cn];
			if (op !== 'miss') c.attached = {bed:n.bed, index:n.index, direction:d};
			c.parked = {bed:n.bed, index:n.index, direction:d};
		}
	} else if (op === 'pause') {
		//ignore
	} else if (op.match(/^x-/)) {
		console.warn("WARNING: unsupported extension operation '" + op + "'.");
	} else {
		error(`unsupported operation '${op}'.`);
	}

}

fs.writeFileSync(outfile, output.join('\n') + '\n', {encoding:'utf8'});
console.log(`Wrote to ${outfile}`);
