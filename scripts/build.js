const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['src/extension.js'],bundle:true,platform:'node',target:'node18',outfile:'dist/extension.js',external:['vscode']});
