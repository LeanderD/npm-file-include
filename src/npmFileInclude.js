#!/usr/bin/env node

/*
* @Author: Leander Dirkse
* @Date:   2016-04-16 18:26:49
* @Last Modified by:   leander
* @Last Modified time: 2016-04-18 22:01:10
*/

'use strict';

const colors      = require( 'colors' );
const fs          = require( 'fs' );
const extfs       = require( 'extfs' );
const path        = require( 'path' );
const glob        = require( 'glob' );
const commander   = require( 'commander' );
const mkdirp      = require( 'mkdirp' );
const progressBar = require( 'progress' );
const pkg         = require( path.join( __dirname, '../package.json' ) );
const root        = process.cwd();

const argList     = val => val.replace( ',', '' ).split( ' ' );
const toBoolean   = val => ( val === 'true' );

commander
    .version( pkg.version )
    .option( '-i, --include <include>', 'files to parse', argList, ['**/*.html'] )
    .option( '-s, --source <source>', 'source directory', argList, ['src'] )
    .option( '-d, --destination <destination>', 'destination directory', 'build' )
    .option( '-o, --omit-source-parent <omit>', 'omit first directory of the source file', toBoolean, true )
    .option( '-r, --include-recursive <recursive>', 'include with recursion', toBoolean, true )
    .option( '--verbose', 'verbose output', false )
    .option( '--extra-verbose', 'even more verbose output (or: show everything)', false )
    .option( '--silent', 'no output', false )
    .parse( process.argv );

let includePattern = /@@include\('(.*)'\)/g;

let summary = {
    written  : 0
    , errors : 0
}

let bar = null;

// LD: all output levels
const logFlags = {
    SILENT         : 0
    , DEFAULT      : 1
    , VERBOSE      : 2
    , EXTRAVERBOSE : 4
};

// LD: log types
const logType = {
    INFO      : colors.blue
    , WARNING : colors.yellow
    , ERROR   : colors.bold.red
    , DEFAULT : ( string ) => string
}

const logConfig = logFlags.SILENT | logFlags.DEFAULT | logFlags.VERBOSE | logFlags.EXTRAVERBOSE;

// LD: set default output level
let outputLevel = logFlags.DEFAULT;

// LD: set output level
if( logConfig & commander.silent ) {
    outputLevel = logFlags.SILENT;
} else if( logConfig & commander.verbose ) {
    outputLevel = logFlags.VERBOSE | logFlags.DEFAULT;
} else if( logConfig & commander.extraVerbose ) {
    outputLevel = logFlags.EXTRAVERBOSE | logFlags.VERBOSE | logFlags.DEFAULT;
}

/**
 * Console output
 * @param  {logType} logType The type for this message. This will set the color of the output
 * @param  {string} message  The message to output
 * @param  {logFlag} level   The level of this message.
 *                           The message will only be shown if the output-level matches this message-level
 */
const log = ( logType, message, level ) => {
    if( outputLevel & level ) {
        console.log( logType( message ) );
    }
}

/**
 * Find all files that match a glob pattern in given directories
 * @param  {array} includes Which files to look for
 * @param  {array} path     Which directories to look in
 * @return {array}          An array of all the files that were found
 */
const findFiles = ( includes, path ) => {
    let fileList = [];

    for( let directory of path ) {
        for( let include of includes ) {
            fileList = fileList.concat( glob.sync( `${directory}/${include}` ) );
        }
    }

    // LD: console output
    log( logType.DEFAULT
       , colors.underline( 'Found files:' ) + `\n ∙ ${fileList.join( '\n ∙ ' )}\n`
       , logFlags.EXTRAVERBOSE
       );

    return fileList;
}

/**
 * Check a string for a regex pattern
 * @param  {string} data    The string to check
 * @param  {RegExp} pattern The pattern to look for
 * @return {array}          An array with all the matches
 */
const getMatches = ( data, pattern ) => {
    let matches  = [];
    let match    = null;

    while( match = pattern.exec( data ) ) {
        matches.push( { string: match[0], filename: match[1] } );
    }

    return matches;
}

/**
 * Check files for a matching regex pattern
 * @param  {array} files    Array of files to check for a pattern
 * @param  {RegExp} pattern The regex patter to look for
 * @return {array}          Array of files where the pattern is found, including the matches
 */
const checkForPattern = ( files, pattern ) => {
    let hasPattern = [];

    if( outputLevel & logFlags.EXTRAVERBOSE ) {
        bar = new progressBar('Checking for pattern        [:bar] :percent :etas', {
            complete     : '='.bold.green
            , incomplete : ' '
            , width      : 20
            , total      : files.length
        });
    }

    for( let file of files ) {

        try {

            // LD: read file
            let contents = fs.readFileSync( file, 'utf8' );
            let matches  = getMatches( contents, pattern );

            if( matches.length ) {
                hasPattern.push( { directory: path.dirname( file ), filename: getFilename( file ), matches } );
            }

            if( outputLevel & logFlags.EXTRAVERBOSE ) bar.tick();
        } catch( error ) {
            if( error.code === 'EISDIR' ) {
                log( logType.ERROR
                   , `Cannot read the source directory`
                   , logFlags.DEFAULT
                   );

                break;
            }
        }
    }

    // LD: console output, check if we should loop through all the files with current outputLevel.
    //     if not skip this
    if( outputLevel & logFlags.EXTRAVERBOSE ) {
        let patternMessage = '';

        for( let withPattern of hasPattern ) {
            let fileMessage = ` ∙ ${withPattern.filename}\n`;

            for( let match of withPattern.matches ) {
                fileMessage += `   - ${match.filename}\n`;
            }

            patternMessage += fileMessage;
        }

        log( logType.DEFAULT
           , colors.underline( '\nFiles with includes:' ) + `\n${patternMessage}`
           , logFlags.EXTRAVERBOSE
           );
    }

    return hasPattern;
}

const removeIncludedFiles = files => {
    if( outputLevel & logFlags.EXTRAVERBOSE ) {
        bar = new progressBar('Checking for included files [:bar] :percent :etas', {
            complete     : '='.bold.green
            , incomplete : ' '
            , width      : 20
            , total      : files.length
        });
    }

    for( let file of files ) {
        if( outputLevel & logFlags.EXTRAVERBOSE ) bar.total += file.matches.length;
        for( let match of file.matches ) {
            files = files.filter( file => getFilename( match.filename ) !== file.filename );

            if( outputLevel & logFlags.EXTRAVERBOSE ) bar.tick();
        }

        if( outputLevel & logFlags.EXTRAVERBOSE ) bar.tick();
    }

    // LD: console output, check if we should loop through all the files with current outputLevel.
    //     if not skip this
    if( outputLevel & logFlags.EXTRAVERBOSE ) {
        let logMessage = colors.underline( '\nFiles to parse:\n' );

        for( let notIncluded of files ) {
            logMessage += ` ∙ ${notIncluded.filename}\n`;
        }

        log( logType.DEFAULT
           , logMessage
           , logFlags.EXTRAVERBOSE
           );
    }

    return files;
}

const getFilename     = file => file.split( '/' ).pop();
const getDirectory    = file => {
    let split = file.split( '/' );
    split.pop();
    return split.join( '/' );
}

const getFileContents = file => fs.readFileSync( file, 'utf8' );

const doFileInclude = ( file, insertNotFound ) => {
    insertNotFound = insertNotFound !== false;

    let contents = '';
    try {
        // LD: get the contents of the file that we try to do includes for
        contents = getFileContents( `${file.directory}/${file.filename}` );

        // LD: check for matches in the files contents
        let matches = getMatches( contents, includePattern );

        for( let match of matches ) {
            let matchDirectory = getDirectory( file.filename );

            match.directory = matchDirectory ? `${file.directory}/${matchDirectory}` : file.directory;

            let matchContents = '';
            if( !!commander.includeRecursive === true ) {
                matchContents = doFileInclude( match );
            } else {
                matchContents = getFileContents( `${match.directory}/${match.filename}` );
            }

            contents = contents.replace( match.string, matchContents );
        }

    } catch( error ) {
        let includeContents = `File not found: ${file.filename}`;

        if( insertNotFound === true ) {
            contents = contents.replace( file.string, includeContents )
        };

        log( logType.ERROR
           , includeContents
           , logFlags.DEFAULT
           );

        summary.errors++;

    }

    return contents;
}

const writeFiles = ( files ) => {
    if( outputLevel & logFlags.EXTRAVERBOSE ) {
        bar = new progressBar('Writing files               [:bar] :percent :etas', {
            complete     : '='.bold.green
            , incomplete : ' '
            , width      : 20
            , total      : files.length
        });
    }

    for( let file of files ) {
        let contents = doFileInclude( file );

        try {
            let path = file.filename;

            if( commander.omitSourceParent !== true ) {
                path = `${file.directory}/${file.filename}`;
            }

            let directory = path.split( '/' );
            directory.pop();
            directory = directory.join( '/' );

            let dirResult = mkdirp.sync( `${commander.destination}/${directory}` );

            fs.writeFileSync( `${commander.destination}/${path}`, contents );

            summary.written++;

            if( outputLevel & logFlags.EXTRAVERBOSE ) bar.tick();
        } catch( error ) {
            log( logType.ERROR
               , `Cannot write file: ${commander.destination}/${path}`
               , logFlags.DEFAULT
               );

            summary.errors++;
        }
    }
}

const init = () => {

    if( outputLevel & ~logFlags.SILENT ) console.time( 'Execution time' );

    let foundFiles = [], hasPattern = [], filesNotIncluded = [];

    foundFiles = findFiles( commander.include, commander.source );

    if( foundFiles.length )         hasPattern       = checkForPattern( foundFiles, includePattern );
    if( hasPattern.length )         filesNotIncluded = removeIncludedFiles( hasPattern );
    if( filesNotIncluded.length )   writeFiles( filesNotIncluded );

    log( logType.INFO
       , `Files written: ${summary.written}, File errors: ${summary.errors}`
       , logFlags.DEFAULT
       );

    if( outputLevel & ~logFlags.SILENT ) console.timeEnd( 'Execution time' );
}

init();
