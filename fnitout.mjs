

class Instruction {
	constructor(op = null) {
		this.op = op;
	}
	toString() {
		if (this.op === null) {
			return "(invalid op)";
		}
		let ret = `${this.op}`;
		if ('direction' in this) ret += ` ${this.direction}`;
		if ('needle' in this) ret += ` ${this.needle}`;
		if ('target' in this) ret += ` ${this.target}`;
		if ('length' in this) ret += ` ${this.length}`;
		if ('yarns' in this) {
			for (const ys of this.yarns) {
				ret += ` (${ys.yarn},${ys.length})`;
			}
		}
		if ('yarn' in this) ret += ` ${this.yarn}`;
		if ('rack' in this) ret += ` ${this.rack}`;
		if ('comment' in this) ret += ` ;${this.comment}`;
		return ret;
	}
}

class Needle {
	constructor(bed = null, index = null) {
		this.bed = bed;
		this.index = index;
	}
	toString() {
		return `${this.bed}.${this.index}`;
	}
}

class ParseError extends Error {
	constructor(message) {
		super(message);
		this.name = "ParseError";
	}
}

export function parseNeedle(tok) {
	const m = tok.match(/^(f|b)\.(-?\d+)$/);
	if (m === null) throw new ParseError(`Expecting bed.index but got '${tok}'.`);
	return new Needle(m[1], parseInt(m[2]));
}


class MachineState {
	constructor() {
		this.rack = 0; //$r$ -- racking offset
		this.loops = {}; //$L$ -- bed.index -> loop count
		this.carriers = {}; //$Y$ -- physical yarn carrier positions (needle, direction)
		this.attachments = {}; //$A$ -- logical last-loop positions
	}
	copy() {
		let ret = new MachineState();
		ret.rack = this.rack;
		Object.assign(ret.loops, this.loops);
		Object.assign(ret.carriers, this.carriers);
		Object.assign(ret.attachments, this.attachments);
		return ret;
	}
	toString() {
		let info = `rack:${this.rack}`;
		for (let y of Object.keys(this.carriers).sort((a,b) => parseInt(a) - parseInt(b))) {
			info += ` y${y}:[${this.carriers[y]} / ${(y in this.attachments ? this.attachments[y].needle + this.attachments[y].direction : 'x')}]`;
		}

		for (let l of Object.keys(this.loops).sort((a,b) => parseInt(a) - parseInt(b))) {
			info += ` ${l}:${this.loops[l]}`;
		}
		return info;
	}
}

//parse: make list of formal knitout instructions from text
//input:
//  either an array of lines or a single string containing a formal knitout program
//output:
//  {
//    instructions:[] an array of instructions
//    errors:[] an array of {line:, message:} for parsing errors
//  }
export function parse(text) {

	//if text isn't already split into an array of lines, do so:
	if (typeof text === 'string') {
		text = text.split(/\r?\n/);
	}

	let instructions = [];
	let errors = [];

	//NOTE: parsing inspired by knitout-to-dat.js's knitout parser
	for (let lineNumber = 1; lineNumber <= text.length; ++lineNumber) {
		try {
			let line = text[lineNumber-1];

			let instruction = new Instruction();
			instruction.line = lineNumber;

			{ //comment:
				let idx = line.indexOf(';');
				if (idx !== -1) {
					instruction.comment = line.substr(idx+1);
					line = line.substr(0,idx);
				}
			}

			//whitespace-separated tokens:
			let tokens = line.split(/\s+/);
			//skip possibly empty first/last tokens:
			if (tokens.length > 0 && tokens[0] === "") tokens.shift();
			if (tokens.length > 0 && tokens[tokens.length-1] === "") tokens.pop();

			if (tokens.length === 0) continue; //skip empty lines

			const op = tokens.shift();
			instruction.op = op;

			function setDir(prop) {
				if (tokens.length === 0) throw new ParseError(`Expecting direction but ran out of tokens.`);
				const tok = tokens.shift();
				if (!(tok === '-' || tok === '+')) throw new ParseError(`Expecting +/- for direction, but got '${tok}'.`);
				instruction[prop] = tok;
			}

			function setNeedle(prop) {
				if (tokens.length === 0) throw new ParseError(`Expecting needle but ran out of tokens.`);
				const tok = tokens.shift();
				instruction[prop] = parseNeedle(tok);
			}

			function setLength(prop) {
				if (tokens.length === 0) throw new ParseError(`Expecting length but ran out of tokens.`);
				const tok = tokens.shift();
				const l = Number(tok);
				if (!isFinite(l)) throw new ParseError(`Expecting length, got '${tok}'.`);
				instruction[prop] = l;
			}

			function setYarns(prop) {
				let yarns = [];
				let used = {};
				while (tokens.length > 0) {
					const tok = tokens.shift();
					const m = tok.match(/^\(([0-9]|[1-9]\d+),([-+0-9.eE]+)\)$/);
					if (m === null) throw new ParseError(`Expecting '(yarn,length)' but got '${tok}'.`);
					const yarn = parseInt(m[1]);
					if (yarn in used) throw new ParseError(`Yarn ${yarn} reused in yarns.`);
					used[yarn] = true;
					const length = Number(m[2]);
					if (!isFinite(length)) throw new ParseError(`Expecting length in yarn but got '${m[2]}'.`);
					yarns.push({yarn, length});
				}
				instruction[prop] = yarns;
			}

			function setYarn(prop) {
				if (tokens.length === 0) throw new ParseError(`Expecting yarn but ran out of tokens.`);
				const tok = tokens.shift();
				if (!/^([0-9]|[1-9]\d+)$/.test(tok)) throw new ParseError(`Expecting yarn but got '${tok}'.`);
				instruction[prop] = parseInt(tok);
			}

			function setRack(prop) {
				if (tokens.length === 0) throw new ParseError(`Expecting rack but ran out of tokens.`);
				const tok = tokens.shift();
				if (!/^[-+]?([0-9]|[1-9]\d+)$/.test(tok)) throw new ParseError(`Expecting rack but got '${tok}'.`);
				instruction[prop] = parseInt(tok);
			}

			if (op === 'knit') {
				//knit dir n.x l yarns
				setDir('direction');
				setNeedle('needle');
				setLength('length');
				setYarns('yarns');
				if (instruction.yarns.length === 0) throw new ParseError(`Knit must have at least one yarn.`);
			} else if (op === 'tuck') {
				//tuck dir n.x l yarn
				setDir('direction');
				setNeedle('needle');
				setLength('length');
				setYarns('yarns');
				if (instruction.yarns.length !== 1) throw new ParseError(`Tuck must have exactly one yarn.`);
			} else if (op === 'split') {
				//split dir n.x n'.w l yarns
				setDir('direction');
				setNeedle('needle');
				setNeedle('target');
				setLength('length');
				setYarns('yarns');
				if (instruction.yarns.length === 0) throw new ParseError(`Split must have at least one yarn.`);
			} else if (op === 'miss' || op === 'in' || op === 'out') {
				//(miss|in|out) dir n.x y
				setDir('direction');
				setNeedle('needle');
				setYarn('yarn');
			} else if (op === 'drop') {
				setNeedle('needle');
			} else if (op === 'xfer') {
				setNeedle('needle');
				setNeedle('target');
			} else if (op === 'rack') {
				setRack('rack');
			} else {
				throw new ParseError(`Unrecognized operation '${op}'.`);
			}
			if (tokens.length > 0) throw new ParseError(`Extra tokens at end of line.`);

			instructions.push(instruction);
		} catch (e) {
			if (e instanceof ParseError) {
				errors.push({line:lineNumber, message:e.message});
			} else {
				throw e;
			}
		}
	}

	return {instructions, errors};
}

/* 
 * validate: construct a trace from a set of formal knitout instructions
 * input:
 *  array of instructions
 * output:
 *  {
 *    trace:[] //machine states such that trace[i] -- instructions[i] --> trace[i+1]
 *    errors:[] //{instruction:, error:} for validation errors
 *  }
 */


export function validate(instructions) {

	class ValidationError extends Error {
		constructor(message) {
			super(message);
			this.name = "ValidationError";
		}
	}

	let trace = [new MachineState()];
	let errors = [];
	for (let i = 0; i < instructions.length; ++i) {
		try {
			const state = trace[trace.length-1].copy();
			const instruction = instructions[i];

			//let info = `${state} -- ${instruction} --> `; //DEBUG

			//return physical position for a logical yarn carrier position:
			// (because direction = '-' adds nothing, you can also use it to come up with physical needle location)
			function physicalPos(needle, direction = '-') {
				if (needle.bed === 'f') return needle.index + (direction === '+' ? 1 : 0);
				return needle.index + state.rack + (direction === '+' ? 1 : 0);
			}

			//check that all yarn carriers are at physical position corresponding to [n.x, dir]_r
			function checkYarns() {
				const yarns = ('yarns' in instruction ? instruction.yarns : [{yarn:instruction.yarn}]);
				const expected = physicalPos(instruction.needle, (instruction.direction === '+' ? '-' : '+'));
				for (const ys of yarns) {
					const yarn = ys.yarn;
					if (!(yarn in state.carriers)) {
						throw new ValidationError(`Using yarn ${yarn}, but it is not in action.`);
					}
					if (state.carriers[yarn] !== expected) {
						throw new ValidationError(`Expected yarn ${yarn} at ${expected}, but it is at ${state.carriers[yarn]}.`);
					}
				}
			}

			//out is a special case that wants the yarn carrier at the physical position [n.x, dir]_r
			function checkOut() {
				const yarns = ('yarns' in instruction ? instruction.yarns : [{yarn:instruction.yarn}]);
				const expected = physicalPos(instruction.needle, instruction.direction);
				for (const ys of yarns) {
					const yarn = ys.yarn;
					if (!(yarn in state.carriers)) {
						throw new ValidationError(`Using yarn ${yarn}, but it is not in action.`);
					}
					if (state.carriers[yarn] !== expected) {
						throw new ValidationError(`Expected yarn ${yarn} at ${expected}, but it is at ${state.carriers[yarn]}.`);
					}
				}
			}

			//check that instruction.needle and instruction.target are aligned:
			function checkTarget() {
				if (instruction.needle.bed === instruction.target.bed) {
					throw new ValidationError(`Needle '${instruction.needle}' and target '${instruction.target}' are not on opposite beds.`);
				}
				if (physicalPos(instruction.needle) !== physicalPos(instruction.target)) {
					throw new ValidationError(`Needle '${instruction.needle}' and target '${instruction.target}' are not aligned at racking ${state.rack}.`);
				}
			}

			//move all attached loops to target needle:
			function moveAttachments() {
				for (const a in state.attachments) {
					if (state.attachments[a].needle.toString() === instruction.needle.toString()) {
						state.attachments[a].needle = instruction.target;
					}
				}
			}

			function setAttachments() {
				for (const ys of instruction.yarns) {
					const yarn = ys.yarn;
					//NOTE: direction is a bit extra vs the paper right now
					state.attachments[yarn] = {needle:instruction.needle, direction:instruction.direction};
				}
			}

			function setYarns() {
				const yarns = ('yarns' in instruction ? instruction.yarns : [{yarn:instruction.yarn}]);
				const at = physicalPos(instruction.needle, instruction.direction);
				for (const ys of yarns) {
					const yarn = ys.yarn;
					state.carriers[yarn] = at;
				}
			}

			if (instruction.op === 'tuck') {
				checkYarns(); //make sure carriers are ready
				//increment loop count at location:
				if (instruction.yarns.length > 0) {
					const n = instruction.needle.toString();
					if (!(n in state.loops)) state.loops[n] = instruction.yarns.length;
					else state.loops[n] += 1;
				}
				setAttachments(); //update attached loops
				setYarns(); //move carriers
			} else if (instruction.op === 'knit') {
				checkYarns(); //make sure carriers are ready
				{ //set loop count at location:
					//NOTE: could assert something is here!
					const n = instruction.needle.toString();
					delete state.loops[n];
					if (instruction.yarns.length) state.loops[n] = instruction.yarns.length;
				}
				setAttachments(); //update attached loops
				setYarns(); //move carriers
			} else if (instruction.op === 'drop') {
				//set loop count at location:
				const n = instruction.needle.toString();
				if (!(n in state.loops) || state.loops[n] <= 0) {
					throw new ValidationError(`Can't drop ${instruction.needle} because it contains no loops.`);
				}
				delete state.loops[n];
			} else if (instruction.op === 'split') {
				checkTarget(); //make sure needles are aligned
				checkYarns(); //make sure carriers are ready

				const n = instruction.needle.toString();
				const t = instruction.target.toString();
				//move loop count:
				if (n in state.loops) {
					if (!(t in state.loops)) state.loops[t] = state.loops[n];
					else state.loops[t] += state.loops[n];
					delete state.loops[n];
				}
				//track newly created loop:
				if (instruction.yarns.length) {
					state.loops[n] = instruction.yarns.length;
				}
				moveAttachments(); //update attachments that got transferred
				setAttachments(); //set new attachments as needed
				setYarns(); //update yarn carrier positions
			} else if (instruction.op === 'miss') {
				checkYarns(); //are yarns ready to miss?
				setYarns(); //then move them.
			} else if (instruction.op === 'in') {
				if (instruction.yarn in state.carriers) {
					throw new ValidationError(`Can't bring in yarn ${instruction.yarn} because it is already in.`);
				}
				setYarns();
				//NOTE: no setAttachments()
			} else if (instruction.op === 'out') {
				checkOut(); //are yarns where out expects them?
				delete state.carriers[instruction.yarn];
				delete state.attachments[instruction.yarn];
			} else if (instruction.op === 'xfer') {
				checkTarget();
				const n = instruction.needle.toString();
				const t = instruction.target.toString();
				//move loop count:
				if (n in state.loops) {
					if (!(t in state.loops)) state.loops[t] = state.loops[n];
					else state.loops[t] += state.loops[n];
					delete state.loops[n];
				}
				moveAttachments(); //update attachments
			} else if (instruction.op === 'rack') {
				if (Math.abs(state.rack - instruction.rack) !== 1) {
					throw new ValidationError(`Change in racking isn't by +/-1 -- from ${state.rack} to ${instruction.rack}.`);
				}
				state.rack = instruction.rack;
			} else {
				throw new ValidationError(`Unrecognized operation '${instruction.op}'.`);
			}
			//info += `${state}`; //DEBUG
			trace.push(state);
			//console.log(info); //DEBUG
		} catch (e) {
			if (e instanceof ValidationError) {
				errors.push({instruction:i, message:e.message});
			} else {
				throw e;
			}
		}

	}
	return {trace, errors};
}


//-------------------------------------------------
//command-line usage, with some care to work okay in browsers also

if (typeof process !== 'undefined') {
	async function init() {
		const url = await import('url');
		const fs = await import('fs');
		if (process.argv[1] !== url.fileURLToPath(import.meta.url)) return;
		if (process.argv.length < 3) {
			console.log("Usage:\n\tnode fnitout.mjs <file-to-parse.f>");
			process.exit(1);
		}
		const inFile = process.argv[2];
		console.log(`Reading '${inFile}'...`);
		const text = fs.readFileSync(inFile, {encoding:'utf8'});
		console.log(`Parsing '${inFile}'...`);
		const parsed = parse(text);
		if (parsed.errors.length) {
			console.log(`Have ${parsed.errors.length} parsing errors:`);
			for (const error of parsed.errors) {
				console.log(`  Line ${error.line}: ${error.message}`);
			}
		}
		console.log(`Parsed ${parsed.instructions.length} instructions.`);
		/*
		for (const instruction of parsed.instructions) {
			console.log(`  ${instruction}`);
		}*/

		const validated = validate(parsed.instructions);

		if (validated.errors.length) {
			console.log(`Have ${validated.errors.length} validation errors:`);
			for (const error of validated.errors) {
				console.log(`  Instruction ${error.instruction}: ${error.message}\n    ${parsed.instructions[error.instruction]}`);
			}
		}
		console.log(`Trace contains ${validated.trace.length} machine states.`);
	}
	init();
}
