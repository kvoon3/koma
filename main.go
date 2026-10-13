// Command koma runs the koma web app in a native window: MyGo hosts the
// Vite-built frontend (mygo.config.ts, frontendDist) in the system webview.
package main

import (
	"log"

	"github.com/egoist/mygo"
)

func main() {
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           "koma",
			Width:           1280,
			Height:          800,
			MinWidth:        720,
			MinHeight:       480,
			BackgroundColor: "light-dark(#ffffff, #0a0a0a)", // the theme colors in index.html
			// The page's top bar draws the title bar itself: the native
			// window controls overlay it, and the --mygo-titlebar-* CSS
			// variables tell the page the room they take.
			TitleBarStyle:        mygo.TitleBarHidden,
			TitleBarHeight:       31, // the --statusH of the top bar
			TrafficLightPosition: &mygo.Point{X: 12, Y: 10}, // centered in the 31 px bar
			// Reopens where the user left it last time.
			StateKey: "main",
			// The frontend: devUrl during `mygo dev`, frontendDist embedded
			// by `mygo build` otherwise.
			URL: "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
