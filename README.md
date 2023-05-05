# Formal Knitout Translation

Formal knitout (fnitout) is a modification on the knitout language ("actual knitout") that makes defining its semantics more straightforward. 
The up-to-date repository can be found [here](https://github.com/textiles-lab/fenced-tangle-supplemental).

## Formal Knitout Verifier

Formal knitout is stricter than actual knitout in terms of the space of valid programs. 
Thus it is useful to have a verifier. 
To check the validity of a fnitout program, run the following:
```
$ node fnitout.mjs <in.fnitout>
```

## Knitout to Fnitout Translation

To translate actual knitout to formal knitout, run the following command:
```
$ node k2f.mjs <in.knitout> <out.fnitout>
```
## Paper examples

The knitout files for the paper examples are found in `examples`. 
Both the original small program and the enlarged version are included.  
