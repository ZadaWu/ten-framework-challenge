import AuthInitializer from "@/components/authInitializer"

export default function TranscriptionLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return <AuthInitializer>{children}</AuthInitializer>
}



