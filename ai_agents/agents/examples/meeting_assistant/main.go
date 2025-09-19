package main

import (
	"log"

	"github.com/TEN-framework/ten_framework/core/go/binding/ten_runtime_go"
)

func main() {
	log.Println("Meeting Assistant starting...")

	// Create TEN app.
	tenApp := ten_runtime_go.NewTenApp()

	// Customize the app.
	tenApp.OnConfigure(func(tenApp ten_runtime_go.TenApp, configJson string) {
		log.Printf("Meeting Assistant app configured with: %s", configJson)
	})

	// Start the app.
	tenApp.Run(false)

	log.Println("Meeting Assistant stopped.")
}